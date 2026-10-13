import { DomainError } from "../../../../shared/domain/domain-error";
import { err, type Result } from "../../../../shared/domain/result";
import { validarMetadatosEvento } from "../../domain/event-metadata";
import type { CreatedPackageDto, CreatePackageDto } from "../dtos/package.dto";
import type { PackageRepository } from "../ports/package-repository.port";

/**
 * Crea un evento (agregado técnico `package`) con un nombre obligatorio y
 * metadatos opcionales (DECOR-44). El tipo de espacio y el área ya no son
 * obligatorios: solo se validan si vienen.
 */
export class CreatePackageUseCase {
  constructor(private readonly packageRepository: Pick<PackageRepository, "create">) {}

  async execute(dto: CreatePackageDto): Promise<Result<CreatedPackageDto, DomainError>> {
    if (!dto.userId || dto.userId.trim().length === 0) {
      return err(new DomainError("package.invalid_user", "El identificador de usuario es obligatorio"));
    }

    const metadata = validarMetadatosEvento(dto);
    if (!metadata.ok) {
      return metadata;
    }

    return this.packageRepository.create({
      ...metadata.value,
      userId: dto.userId,
    });
  }
}
