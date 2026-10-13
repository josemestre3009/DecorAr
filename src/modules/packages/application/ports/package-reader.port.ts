import type { DomainError } from "../../../../shared/domain/domain-error";
import type { Result } from "../../../../shared/domain/result";
import type { EventMetadataDto, SpatialDiagnosticDto } from "../dtos/package.dto";

export interface PackageItemSummary {
  readonly itemId: string;
  readonly moduleId: string;
  readonly areaM2: number;
}

export interface PackageDetail extends EventMetadataDto {
  readonly id: string;
  readonly userId: string;
  readonly version: number;
  readonly items: readonly PackageItemSummary[];
}

export interface PackageSummary extends EventMetadataDto {
  readonly id: string;
  readonly updatedAt: string;
  readonly spatial: SpatialDiagnosticDto;
}

export interface PackageListReader {
  listByOwner(userId: string): Promise<Result<readonly PackageSummary[], DomainError>>;
}

export interface PackageReader {
  getPackage(packageId: string, userId: string): Promise<Result<PackageDetail | null, DomainError>>;
  getItemModuleId(packageId: string, itemId: string): Promise<Result<string | null, DomainError>>;
}
