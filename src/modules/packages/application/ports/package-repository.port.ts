import type { DomainError } from "../../../../shared/domain/domain-error";
import type { Result } from "../../../../shared/domain/result";
import type { TipoEspacio } from "../../domain/space-type";
import type {
  ClonedPackageDto,
  ClonePackageDto,
  CreatedPackageDto,
  PackageMetadataPatch,
} from "../dtos/package.dto";

export interface CreatePackageParams {
  readonly userId: string;
  readonly name: string;
  readonly spaceType: TipoEspacio | null;
  readonly capacityM2: number | null;
  readonly clientName: string | null;
  readonly eventDate: string | null;
  readonly venue: string | null;
  readonly eventType: string | null;
}

export interface UpdatePackageMetadataParams {
  readonly packageId: string;
  readonly userId: string;
  readonly patch: PackageMetadataPatch;
}

export interface PackageRepository {
  create(params: CreatePackageParams): Promise<Result<CreatedPackageDto, DomainError>>;

  updateMetadata(params: UpdatePackageMetadataParams): Promise<Result<CreatedPackageDto, DomainError>>;

  clone(params: ClonePackageDto): Promise<Result<ClonedPackageDto, DomainError>>;
}
