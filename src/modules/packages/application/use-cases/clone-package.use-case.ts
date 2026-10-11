import { DomainError } from "../../../../shared/domain/domain-error";
import { err, type Result } from "../../../../shared/domain/result";
import type { ClonedPackageDto, ClonePackageDto } from "../dtos/package.dto";
import type { PackageRepository } from "../ports/package-repository.port";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Caso de uso: Clonar paquete mediante el patrón Prototype y persistencia atómica (DECOR-24).
 *
 * Duplica un paquete base y todos sus elementos dependientes en una única transacción de
 * base de datos invocando la RPC atómica `clone_package`.
 * Conforme a la especificación fija de DECOR-24:
 * "El clon no emite evento de dominio ni recalcula hasta una mutación posterior sobre él."
 */
export class ClonePackageUseCase {
  constructor(private readonly packageRepository: Pick<PackageRepository, "clone">) {}


  async execute(dto: ClonePackageDto): Promise<Result<ClonedPackageDto, DomainError>> {
    const { sourcePackageId, userId } = dto;

    if (!userId || userId.trim().length === 0) {
      return err(
        new DomainError("auth.unauthenticated", "Inicia sesión para continuar."),
      );
    }

    if (!sourcePackageId || !UUID_REGEX.test(sourcePackageId)) {
      return err(
        new DomainError("package.not_found", "No encontramos este paquete de decoración."),
      );
    }

    return this.packageRepository.clone({
      sourcePackageId,
      userId,
    });
  }
}
