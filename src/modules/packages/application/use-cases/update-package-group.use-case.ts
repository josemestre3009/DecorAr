import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../../shared/domain/result";
import type { UpdatedPackageGroupDto, UpdatePackageGroupDto } from "../dtos/package-group.dto";
import type {
  PackageGroupReader,
  PackageStructureEditorRepository,
} from "../ports/package-group-repository.port";
import type { PackageReader } from "../ports/package-reader.port";
import { loadPackageTree } from "./load-package-tree";

/**
 * `PATCH /groups/{groupId}`: renombra y/o mueve una zona conservando su id y
 * su contenido. Carga el árbol completo, aplica las operaciones sobre el
 * Composite (que valida trim 1..80, ciclos y profundidad) y sólo entonces
 * envía la versión observada a la RPC atómica.
 */
export class UpdatePackageGroupUseCase {
  constructor(
    private readonly packageReader: PackageReader,
    private readonly groupReader: PackageGroupReader,
    private readonly editor: PackageStructureEditorRepository,
  ) {}

  async execute(dto: UpdatePackageGroupDto): Promise<Result<UpdatedPackageGroupDto, DomainError>> {
    if (!dto.packageId || dto.packageId.trim().length === 0) {
      return err(new DomainError("package.invalid", "Identificador de paquete inválido"));
    }

    if (!dto.userId || dto.userId.trim().length === 0) {
      return err(new DomainError("package.invalid_user", "Identificador de usuario inválido"));
    }

    if (!dto.groupId || dto.groupId.trim().length === 0) {
      return err(new DomainError("package.group_not_found", "No encontramos ese grupo en el paquete."));
    }

    if (dto.name === undefined && dto.parentGroupId === undefined) {
      return err(new DomainError("package.invalid", "Debe indicar un nombre o un grupo padre"));
    }

    if (typeof dto.parentGroupId === "string" && dto.parentGroupId.trim().length === 0) {
      return err(new DomainError("package.invalid_group", "El grupo no es válido"));
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

    if (dto.name !== undefined) {
      const renamed = grupo.renombrar(dto.name);
      if (!renamed.ok) {
        return err(renamed.error);
      }
    }

    let parentGroupId: string | null | undefined;
    if (dto.parentGroupId !== undefined) {
      parentGroupId = dto.parentGroupId === null ? null : dto.parentGroupId.trim();
      const moved = tree.value.paquete.moverGrupo(groupId, parentGroupId);
      if (!moved.ok) {
        return err(moved.error);
      }
    }

    const version = await this.editor.updateGroup({
      correlationId: dto.correlationId ?? null,
      expectedVersion: tree.value.detail.version,
      groupId,
      name: dto.name === undefined ? undefined : grupo.nombre,
      packageId: dto.packageId,
      parentGroupId,
      userId: dto.userId,
    });
    if (!version.ok) {
      return err(version.error);
    }

    return ok({
      groupId,
      name: grupo.nombre,
      packageVersion: version.value,
      parentGroupId: grupo.padre?.id ?? null,
    });
  }
}
