import { DomainError } from "../../../../shared/domain/domain-error";
import { err, type Result } from "../../../../shared/domain/result";
import { validarParcheMetadatos } from "../../domain/event-metadata";
import type { CreatedPackageDto, UpdatePackageMetadataDto } from "../dtos/package.dto";
import type { PackageRepository } from "../ports/package-repository.port";

/**
 * Actualiza los metadatos de un evento sin tocar su configuración decorativa
 * (DECOR-44). Solo el propietario puede hacerlo; el repositorio filtra por
 * `user_id` y devuelve `package.not_found` para un evento ajeno o inexistente.
 */
export class UpdatePackageMetadataUseCase {
  constructor(private readonly packageRepository: Pick<PackageRepository, "updateMetadata">) {}

  async execute(dto: UpdatePackageMetadataDto): Promise<Result<CreatedPackageDto, DomainError>> {
    if (!dto.packageId || dto.packageId.trim().length === 0) {
      return err(new DomainError("package.not_found", "No encontramos este evento."));
    }

    if (!dto.userId || dto.userId.trim().length === 0) {
      return err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar."));
    }

    const patch = validarParcheMetadatos(dto.patch ?? {});
    if (!patch.ok) {
      return patch;
    }

    return this.packageRepository.updateMetadata({
      packageId: dto.packageId,
      patch: patch.value,
      userId: dto.userId,
    });
  }
}
