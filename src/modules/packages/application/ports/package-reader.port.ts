import type { DomainError } from "../../../../shared/domain/domain-error";
import type { Result } from "../../../../shared/domain/result";
import type { TipoEspacio } from "../../domain/space-type";

export interface PackageItemSummary {
  readonly itemId: string;
  readonly moduleId: string;
  readonly areaM2: number;
}

export interface PackageDetail {
  readonly id: string;
  readonly userId: string;
  readonly spaceType: TipoEspacio;
  readonly capacityM2: number;
  readonly version: number;
  readonly items: readonly PackageItemSummary[];
}

export interface PackageReader {
  getPackage(packageId: string, userId: string): Promise<Result<PackageDetail | null, DomainError>>;
  getItemModuleId(packageId: string, itemId: string): Promise<Result<string | null, DomainError>>;
}
