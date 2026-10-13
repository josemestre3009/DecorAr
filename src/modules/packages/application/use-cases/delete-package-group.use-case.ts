import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../../shared/domain/result";
import type { Clock, IdGenerator } from "../../../../shared/application/ports";
import type { PackageModuleMovedEvent, PackageModuleRemovedEvent } from "../../../events/domain/event-contracts";
import type { DeletedPackageGroupDto, DeletePackageGroupDto } from "../dtos/package-group.dto";
import { notifyPackageChange, type PackageChangeConsumer } from "../ports/package-change-consumer.port";
import type {
  PackageGroupReader,
  PackageStructureEditEvent,
  PackageStructureEditorRepository,
} from "../ports/package-group-repository.port";
import type { PackageReader } from "../ports/package-reader.port";
import { loadPackageTree } from "./load-package-tree";

/**
 * `DELETE /groups/{groupId}` con estrategia explícita. `move_to_root` emite un
 * `package.module.moved` por cada hoja directa y la RPC sube las subzonas a la
 * raíz; `delete_contents` emite un `package.module.removed` por cada hoja del
 * subárbol. Ambas son una sola transacción y notifican a Presupuesto una vez.
 */
export class DeletePackageGroupUseCase {
  constructor(
    private readonly packageReader: PackageReader,
    private readonly groupReader: PackageGroupReader,
    private readonly editor: PackageStructureEditorRepository,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly changeConsumer?: PackageChangeConsumer,
  ) {}

  async execute(dto: DeletePackageGroupDto): Promise<Result<DeletedPackageGroupDto, DomainError>> {
    if (!dto.packageId || dto.packageId.trim().length === 0) {
      return err(new DomainError("package.invalid", "Identificador de paquete inválido"));
    }

    if (!dto.userId || dto.userId.trim().length === 0) {
      return err(new DomainError("package.invalid_user", "Identificador de usuario inválido"));
    }

    if (!dto.groupId || dto.groupId.trim().length === 0) {
      return err(new DomainError("package.group_not_found", "No encontramos ese grupo en el paquete."));
    }

    if (dto.strategy !== "move_to_root" && dto.strategy !== "delete_contents") {
      return err(new DomainError("package.invalid", "La estrategia de eliminación no es válida"));
    }

    const tree = await loadPackageTree(this.packageReader, this.groupReader, dto.packageId, dto.userId);
    if (!tree.ok) {
      return err(tree.error);
    }
    if (dto.expectedVersion !== undefined && dto.expectedVersion !== tree.value.detail.version) {
      return err(new DomainError("package.version_conflict", "El evento cambió mientras guardabas. Vuelve a intentarlo."));
    }

    const groupId = dto.groupId.trim();
    const grupo = tree.value.paquete.buscarGrupo(groupId);
    if (!grupo) {
      return err(new DomainError("package.group_not_found", "No encontramos ese grupo en el paquete."));
    }

    const occurredAt = this.clock.now().toISOString();
    const moduleIdByItem = new Map(tree.value.detail.items.map((item) => [item.itemId, item.moduleId]));
    const events: PackageStructureEditEvent[] = [];

    if (dto.strategy === "delete_contents") {
      for (const modulo of grupo.obtenerModulos()) {
        const removed: PackageModuleRemovedEvent = {
          eventId: this.idGenerator.generate(),
          occurredAt,
          packageId: dto.packageId,
          payload: { itemId: modulo.id, moduleId: moduleIdByItem.get(modulo.id) ?? modulo.nombre },
          schemaVersion: 1,
          type: "package.module.removed",
          userId: dto.userId,
        };
        events.push(removed);
      }
    } else {
      for (const hijo of grupo.hijos) {
        if (hijo.profundidad() !== 0) {
          continue;
        }

        const moved: PackageModuleMovedEvent = {
          eventId: this.idGenerator.generate(),
          occurredAt,
          packageId: dto.packageId,
          payload: {
            fromGroupId: groupId,
            itemId: hijo.id,
            moduleId: moduleIdByItem.get(hijo.id) ?? hijo.nombre,
            toGroupId: null,
          },
          schemaVersion: 1,
          type: "package.module.moved",
          userId: dto.userId,
        };
        events.push(moved);
      }
    }

    const version = await this.editor.deleteGroup({
      correlationId: dto.correlationId ?? null,
      events,
      expectedVersion: tree.value.detail.version,
      groupId,
      packageId: dto.packageId,
      strategy: dto.strategy,
      userId: dto.userId,
    });
    if (!version.ok) {
      return err(version.error);
    }

    // Una sola notificación final: Presupuesto relee el paquete con la versión
    // ya confirmada, así que el último evento basta como disparo.
    const lastEvent = events.at(-1);
    if (lastEvent) {
      await notifyPackageChange(this.changeConsumer, lastEvent);
    }

    return ok({ groupId, packageVersion: version.value, strategy: dto.strategy });
  }
}
