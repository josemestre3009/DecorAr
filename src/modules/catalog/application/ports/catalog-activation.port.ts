import type { DomainError } from "../../../../shared/domain/domain-error";
import type { Result } from "../../../../shared/domain/result";
import type { CatalogModule } from "../../domain/catalog-module";

export interface ActivateCatalogModuleParams {
  readonly assetId: string;
  readonly version: number;
  readonly glbUrl: string;
  readonly usdzUrl: string;
  readonly posterUrl: string;
  readonly widthM: number;
  readonly heightM: number;
  readonly depthM: number;
}

export interface CatalogActivationPort {
  activateModule(
    params: ActivateCatalogModuleParams,
  ): Promise<Result<CatalogModule, DomainError>>;
}
