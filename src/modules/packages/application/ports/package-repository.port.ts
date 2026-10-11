import type { DomainError } from "../../../../shared/domain/domain-error";
import type { Result } from "../../../../shared/domain/result";
import type { TipoEspacio } from "../../domain/space-type";
import type { ClonedPackageDto, ClonePackageDto, CreatedPackageDto } from "../dtos/package.dto";

export interface PackageRepository {
  create(params: {
    userId: string;
    spaceType: TipoEspacio;
    capacityM2: number;
  }): Promise<Result<CreatedPackageDto, DomainError>>;

  clone(params: ClonePackageDto): Promise<Result<ClonedPackageDto, DomainError>>;
}

