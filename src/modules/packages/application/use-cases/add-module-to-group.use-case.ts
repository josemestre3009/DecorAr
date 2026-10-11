import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../../shared/domain/result";
import type { Clock, IdGenerator } from "../../../../shared/application/ports";
import type { PackageModuleAddedEvent } from "../../../events/domain/event-contracts";
import { ElementoDecorativo } from "../../domain/decorative-element";
import type { AddedItemDto } from "../dtos/package.dto";
import type { AddModuleToGroupDto } from "../dtos/package-group.dto";
import type { CatalogModuleReader } from "../ports/catalog-module-reader.port";
import { notifyPackageChange, type PackageChangeConsumer } from "../ports/package-change-consumer.port";
import type { PackageGroupReader, PackageGroupRepository } from "../ports/package-group-repository.port";
import type { PackageReader } from "../ports/package-reader.port";
import { loadPackageTree } from "./load-package-tree";

/**
 * `POST /items` con `parentGroupId`: agrega una hoja dentro de un grupo
 * existente. Emite el mismo `package.module.added` que una hoja suelta, así
 * que Presupuesto recalcula igual (los grupos no tienen precio propio).
 */
export class AddModuleToGroupUseCase {
  constructor(
    private readonly packageReader: PackageReader,
    private readonly groupReader: PackageGroupReader,
    private readonly catalogReader: CatalogModuleReader,
    private readonly groupRepository: PackageGroupRepository,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly changeConsumer?: PackageChangeConsumer,
  ) {}

  async execute(dto: AddModuleToGroupDto): Promise<Result<AddedItemDto, DomainError>> {
    if (!dto.packageId || dto.packageId.trim().length === 0) {
      return err(new DomainError("package.invalid", "Identificador de paquete inválido"));
    }

    if (!dto.userId || dto.userId.trim().length === 0) {
      return err(new DomainError("package.invalid_user", "Identificador de usuario inválido"));
    }

    if (!dto.moduleId || dto.moduleId.trim().length === 0) {
      return err(new DomainError("package.invalid_module", "El módulo no es válido"));
    }

    if (!dto.groupId || dto.groupId.trim().length === 0) {
      return err(new DomainError("package.group_not_found", "No encontramos ese grupo en el paquete."));
    }

    const tree = await loadPackageTree(this.packageReader, this.groupReader, dto.packageId, dto.userId);
    if (!tree.ok) {
      return err(tree.error);
    }

    const moduleId = dto.moduleId.trim();
    const moduleResult = await this.catalogReader.getModuleById(moduleId);
    if (!moduleResult.ok) {
      return err(moduleResult.error);
    }
    if (!moduleResult.value) {
      return err(new DomainError("package.module_not_found", "El módulo no existe en el catálogo"));
    }

    const itemId = this.idGenerator.generate();
    const placed = tree.value.paquete.agregarComponente(
      new ElementoDecorativo({
        id: itemId,
        nombre: moduleResult.value.name,
        ocupaM2: moduleResult.value.areaM2,
        precio: moduleResult.value.priceCop,
      }),
      dto.groupId.trim(),
    );
    if (!placed.ok) {
      return err(placed.error);
    }

    const event: PackageModuleAddedEvent = {
      eventId: this.idGenerator.generate(),
      occurredAt: this.clock.now().toISOString(),
      packageId: dto.packageId,
      payload: { itemId, moduleId },
      schemaVersion: 1,
      type: "package.module.added",
      userId: dto.userId,
    };

    const committed = await this.groupRepository.addItemToGroup(
      event,
      dto.groupId.trim(),
      tree.value.detail.version,
      dto.correlationId,
    );
    if (!committed.ok) {
      return err(committed.error);
    }

    await notifyPackageChange(this.changeConsumer, event);

    return ok({ itemId, packageVersion: committed.value });
  }
}
