import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../../shared/domain/result";
import type { DeletedPackageGroupDto, DeletePackageGroupDto } from "../dtos/package-group.dto";
import type { PackageGroupReader, PackageGroupRepository } from "../ports/package-group-repository.port";
import type { PackageReader } from "../ports/package-reader.port";
import { loadPackageTree } from "./load-package-tree";
import { validateIds } from "./rename-package-group.use-case";

/**
 * Elimina un grupo decorativo sin perder contenido (DECOR-43): sus hojas y
 * subgrupos pasan al padre del grupo, o a la raíz. El dominio comprueba
 * primero que la promoción es válida; la base la repite y la confirma en una
 * sola transacción. El conjunto de módulos no cambia, así que no hay eventos
 * de módulo ni recálculo del presupuesto.
 */
export class DeletePackageGroupUseCase {
  constructor(
    private readonly packageReader: PackageReader,
    private readonly groupReader: PackageGroupReader,
    private readonly groupRepository: PackageGroupRepository,
  ) {}

  async execute(dto: DeletePackageGroupDto): Promise<Result<DeletedPackageGroupDto, DomainError>> {
    const invalid = validateIds(dto);
    if (invalid) {
      return err(invalid);
    }

    const tree = await loadPackageTree(this.packageReader, this.groupReader, dto.packageId, dto.userId);
    if (!tree.ok) {
      return err(tree.error);
    }

    const groupId = dto.groupId.trim();
    const dissolved = tree.value.paquete.disolverGrupo(groupId);
    if (!dissolved.ok) {
      return err(dissolved.error);
    }

    const deleted = await this.groupRepository.deleteGroup({
      expectedVersion: tree.value.detail.version,
      groupId,
      packageId: dto.packageId,
      userId: dto.userId,
    });
    if (!deleted.ok) {
      return err(deleted.error);
    }

    return ok(deleted.value);
  }
}
