import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../../shared/domain/result";
import type { Clock, IdGenerator } from "../../../../shared/application/ports";
import type { PackageModuleAddedEvent } from "../../../events/domain/event-contracts";
import { ModuloCompuesto } from "../../domain/composite-module";
import { ElementoDecorativo } from "../../domain/decorative-element";
import type { CreatedPackageGroupDto, CreatePackageGroupDto } from "../dtos/package-group.dto";
import type { CatalogModuleReader } from "../ports/catalog-module-reader.port";
import { notifyPackageChange, type PackageChangeConsumer } from "../ports/package-change-consumer.port";
import type { PackageGroupReader, PackageGroupRepository } from "../ports/package-group-repository.port";
import type { PackageReader } from "../ports/package-reader.port";
import { loadPackageTree } from "./load-package-tree";

/** Límite defensivo de hojas por petición; la demo usa dos (arco + mesa). */
export const MAX_HOJAS_POR_GRUPO = 20;

/**
 * Crea un grupo decorativo (Composite) con sus hojas. Valida todo en el
 * dominio (nombre, capacidad, niveles, ciclos) y después confirma el grupo,
 * las hojas y un `package.module.added` por hoja en una sola transacción.
 * Un grupo sin hojas no emite eventos, así que no recalcula el presupuesto.
 */
export class CreatePackageGroupUseCase {
  constructor(
    private readonly packageReader: PackageReader,
    private readonly groupReader: PackageGroupReader,
    private readonly catalogReader: CatalogModuleReader,
    private readonly groupRepository: PackageGroupRepository,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly changeConsumer?: PackageChangeConsumer,
  ) {}

  async execute(dto: CreatePackageGroupDto): Promise<Result<CreatedPackageGroupDto, DomainError>> {
    if (!dto.packageId || dto.packageId.trim().length === 0) {
      return err(new DomainError("package.invalid", "Identificador de paquete inválido"));
    }

    if (!dto.userId || dto.userId.trim().length === 0) {
      return err(new DomainError("package.invalid_user", "Identificador de usuario inválido"));
    }

    const moduleIds = dto.moduleIds ?? [];
    if (moduleIds.length > MAX_HOJAS_POR_GRUPO) {
      return err(
        new DomainError(
          "package.too_many_children",
          `Un grupo admite como máximo ${MAX_HOJAS_POR_GRUPO} elementos por petición`,
        ),
      );
    }

    if (moduleIds.some((moduleId) => typeof moduleId !== "string" || moduleId.trim().length === 0)) {
      return err(new DomainError("package.invalid_module", "El módulo no es válido"));
    }

    // Ausente o null = raíz; un id en blanco es un error, no la raíz.
    if (typeof dto.parentGroupId === "string" && dto.parentGroupId.trim().length === 0) {
      return err(new DomainError("package.invalid_group", "El grupo no es válido"));
    }
    const parentGroupId = dto.parentGroupId?.trim() ?? null;
    const groupId = this.idGenerator.generate();

    const newGroup = ModuloCompuesto.crear(groupId, dto.name);
    if (!newGroup.ok) {
      return err(newGroup.error);
    }

    const tree = await loadPackageTree(this.packageReader, this.groupReader, dto.packageId, dto.userId);
    if (!tree.ok) {
      return err(tree.error);
    }

    const leaves: { itemId: string; moduleId: string }[] = [];
    for (const rawModuleId of moduleIds) {
      const moduleId = rawModuleId.trim();
      const moduleResult = await this.catalogReader.getModuleById(moduleId);
      if (!moduleResult.ok) {
        return err(moduleResult.error);
      }
      if (!moduleResult.value) {
        return err(new DomainError("package.module_not_found", "El módulo no existe en el catálogo"));
      }

      const itemId = this.idGenerator.generate();
      const added = newGroup.value.agregar(
        new ElementoDecorativo({
          id: itemId,
          nombre: moduleResult.value.name,
          ocupaM2: moduleResult.value.areaM2,
          precio: moduleResult.value.priceCop,
        }),
      );
      if (!added.ok) {
        return err(added.error);
      }
      leaves.push({ itemId, moduleId });
    }

    const placed = tree.value.paquete.agregarComponente(newGroup.value, parentGroupId ?? undefined);
    if (!placed.ok) {
      return err(placed.error);
    }

    const occurredAt = this.clock.now().toISOString();
    const events: PackageModuleAddedEvent[] = leaves.map((leaf) => ({
      eventId: this.idGenerator.generate(),
      occurredAt,
      packageId: dto.packageId,
      payload: { itemId: leaf.itemId, moduleId: leaf.moduleId },
      schemaVersion: 1,
      type: "package.module.added",
      userId: dto.userId,
    }));

    const created = await this.groupRepository.createGroup({
      correlationId: dto.correlationId ?? null,
      events,
      expectedVersion: tree.value.detail.version,
      groupId,
      name: newGroup.value.nombre,
      packageId: dto.packageId,
      parentGroupId,
      userId: dto.userId,
    });
    if (!created.ok) {
      return err(created.error);
    }

    // Un solo recálculo por petición: Presupuesto relee el paquete con la
    // versión final, así que el último evento ya incluye todas las hojas; los
    // anteriores darían `applied=false`. Un grupo vacío no notifica.
    const lastEvent = events.at(-1);
    if (lastEvent) {
      await notifyPackageChange(this.changeConsumer, lastEvent);
    }

    return ok({
      depth: created.value.depth,
      groupId: created.value.groupId,
      itemIds: created.value.itemIds,
      name: newGroup.value.nombre,
      packageVersion: created.value.packageVersion,
      parentGroupId,
    });
  }
}
