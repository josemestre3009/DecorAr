import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../../shared/domain/result";
import type { RenamedPackageGroupDto, RenamePackageGroupDto } from "../dtos/package-group.dto";
import type { PackageGroupReader, PackageGroupRepository } from "../ports/package-group-repository.port";
import type { PackageReader } from "../ports/package-reader.port";
import { loadPackageTree } from "./load-package-tree";

/**
 * Renombra un grupo decorativo (DECOR-43). Valida el nombre y que el grupo
 * exista en el dominio, y después lo confirma en una transacción que solo
 * cambia el nombre: hijos, hojas, subtotales y niveles quedan igual. No
 * emite eventos ni recalcula el presupuesto.
 */
export class RenamePackageGroupUseCase {
  constructor(
    private readonly packageReader: PackageReader,
    private readonly groupReader: PackageGroupReader,
    private readonly groupRepository: PackageGroupRepository,
  ) {}

  async execute(dto: RenamePackageGroupDto): Promise<Result<RenamedPackageGroupDto, DomainError>> {
    const invalid = validateIds(dto);
    if (invalid) {
      return err(invalid);
    }

    const tree = await loadPackageTree(this.packageReader, this.groupReader, dto.packageId, dto.userId);
    if (!tree.ok) {
      return err(tree.error);
    }

    const grupo = tree.value.paquete.buscarGrupo(dto.groupId.trim());
    if (!grupo) {
      return err(new DomainError("package.group_not_found", "No encontramos ese grupo en el paquete."));
    }

    const renamed = grupo.renombrar(dto.name);
    if (!renamed.ok) {
      return err(renamed.error);
    }

    const saved = await this.groupRepository.renameGroup({
      expectedVersion: tree.value.detail.version,
      groupId: grupo.id,
      name: grupo.nombre,
      packageId: dto.packageId,
      userId: dto.userId,
    });
    if (!saved.ok) {
      return err(saved.error);
    }

    return ok(saved.value);
  }
}

/** Identificadores obligatorios comunes a renombrar y eliminar. */
export function validateIds(dto: {
  readonly packageId: string;
  readonly userId: string;
  readonly groupId: string;
}): DomainError | null {
  if (!dto.packageId || dto.packageId.trim().length === 0) {
    return new DomainError("package.invalid", "Identificador de paquete inválido");
  }

  if (!dto.userId || dto.userId.trim().length === 0) {
    return new DomainError("package.invalid_user", "Identificador de usuario inválido");
  }

  if (typeof dto.groupId !== "string" || dto.groupId.trim().length === 0) {
    return new DomainError("package.invalid_group", "El grupo no es válido");
  }

  return null;
}
