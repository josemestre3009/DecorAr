import { DomainError } from "../../../../shared/domain/domain-error";
import { err, type Result } from "../../../../shared/domain/result";
import { isTipoEspacio, isValidCapacityM2, MAX_CAPACITY_M2 } from "../../domain/space-type";
import type { CreatedPackageDto, CreatePackageDto } from "../dtos/package.dto";
import type { PackageRepository } from "../ports/package-repository.port";

export class CreatePackageUseCase {
  constructor(private readonly packageRepository: PackageRepository) {}

  async execute(dto: CreatePackageDto): Promise<Result<CreatedPackageDto, DomainError>> {
    if (!dto.userId || dto.userId.trim().length === 0) {
      return err(new DomainError("package.invalid_user", "El identificador de usuario es obligatorio"));
    }

    if (!isTipoEspacio(dto.spaceType)) {
      return err(
        new DomainError("package.invalid_space_type", `Tipo de espacio no soportado: ${String(dto.spaceType)}`),
      );
    }

    if (!isValidCapacityM2(dto.capacityM2)) {
      return err(
        new DomainError(
          "package.invalid_capacity",
          `La capacidad debe ser un número positivo, finito y menor o igual a ${MAX_CAPACITY_M2} m²`,
        ),
      );
    }

    return this.packageRepository.create({
      capacityM2: dto.capacityM2,
      spaceType: dto.spaceType,
      userId: dto.userId,
    });
  }
}
