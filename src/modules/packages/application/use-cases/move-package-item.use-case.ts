import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../../shared/domain/result";
import type { Clock, IdGenerator } from "../../../../shared/application/ports";
import type { PackageModuleMovedEvent } from "../../../events/domain/event-contracts";
import type { MovedPackageItemDto, MovePackageItemDto } from "../dtos/package-group.dto";
import { notifyPackageChange, type PackageChangeConsumer } from "../ports/package-change-consumer.port";
import type {
  PackageGroupReader,
  PackageStructureEditorRepository,
} from "../ports/package-group-repository.port";
import type { PackageReader } from "../ports/package-reader.port";
import { loadPackageTree } from "./load-package-tree";

/**
 * `PATCH /items/{itemId}` con `{ groupId }`: mueve una instancia existente
 * entre la raíz y zonas válidas del mismo evento. Conserva `itemId` y
 * `moduleId` (no recrea el item ni toca el catálogo) y emite un único
 * `package.module.moved` dentro de la RPC atómica.
 */
export class MovePackageItemUseCase {
  constructor(
    private readonly packageReader: PackageReader,
    private readonly groupReader: PackageGroupReader,
    private readonly editor: PackageStructureEditorRepository,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly changeConsumer?: PackageChangeConsumer,
  ) {}

  async execute(dto: MovePackageItemDto): Promise<Result<MovedPackageItemDto, DomainError>> {
    if (!dto.packageId || dto.packageId.trim().length === 0) {
      return err(new DomainError("package.invalid", "Identificador de paquete inválido"));
    }

    if (!dto.userId || dto.userId.trim().length === 0) {
      return err(new DomainError("package.invalid_user", "Identificador de usuario inválido"));
    }

    if (!dto.itemId || dto.itemId.trim().length === 0) {
      return err(new DomainError("package.item_not_found", "No encontramos este elemento en el paquete."));
    }

    if (typeof dto.groupId === "string" && dto.groupId.trim().length === 0) {
      return err(new DomainError("package.invalid_group", "El grupo no es válido"));
    }

    const destino = dto.groupId === null ? null : dto.groupId.trim();

    const tree = await loadPackageTree(this.packageReader, this.groupReader, dto.packageId, dto.userId);
    if (!tree.ok) {
      return err(tree.error);
    }
    if (dto.expectedVersion !== undefined && dto.expectedVersion !== tree.value.detail.version) {
      return err(new DomainError("package.version_conflict", "El evento cambió mientras guardabas. Vuelve a intentarlo."));
    }

    const itemId = dto.itemId.trim();
    const componente = tree.value.paquete.buscarComponente(itemId);
    if (!componente) {
      return err(new DomainError("package.item_not_found", "No encontramos este elemento en el paquete."));
    }

    if (destino !== null && !tree.value.paquete.buscarGrupo(destino)) {
      return err(new DomainError("package.group_not_found", "No encontramos ese grupo en el paquete."));
    }

    const origen = componente.padre?.id ?? null;
    if (origen === destino) {
      return ok({ groupId: destino, itemId, packageVersion: tree.value.detail.version });
    }

    const moved = tree.value.paquete.moverComponente(itemId, destino);
    if (!moved.ok) {
      return err(moved.error);
    }

    const moduleId =
      tree.value.detail.items.find((item) => item.itemId === itemId)?.moduleId ?? componente.nombre;
    const event: PackageModuleMovedEvent = {
      eventId: this.idGenerator.generate(),
      occurredAt: this.clock.now().toISOString(),
      packageId: dto.packageId,
      payload: { fromGroupId: origen, itemId, moduleId, toGroupId: destino },
      schemaVersion: 1,
      type: "package.module.moved",
      userId: dto.userId,
    };

    const version = await this.editor.moveItem({
      correlationId: dto.correlationId ?? null,
      event,
      expectedVersion: tree.value.detail.version,
      groupId: destino,
      itemId,
      packageId: dto.packageId,
      userId: dto.userId,
    });
    if (!version.ok) {
      return err(version.error);
    }

    await notifyPackageChange(this.changeConsumer, event);

    return ok({ groupId: destino, itemId, packageVersion: version.value });
  }
}
