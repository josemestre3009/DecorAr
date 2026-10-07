import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";

export type CatalogModuleStatus = "draft" | "active" | "retired";

export interface CatalogModuleProps {
  readonly id: string;
  readonly assetId: string;
  readonly version: number;
  readonly name: string;
  readonly priceCop: number;
  readonly areaM2: number;
  readonly widthM: number | null;
  readonly heightM: number | null;
  readonly depthM: number | null;
  readonly glbUrl: string | null;
  readonly usdzUrl: string | null;
  readonly posterUrl: string | null;
  readonly status: CatalogModuleStatus;
}

export class CatalogModule {
  private constructor(private readonly props: CatalogModuleProps) {}

  public static create(props: CatalogModuleProps): Result<CatalogModule, DomainError> {
    if (!props.id || props.id.trim().length === 0) {
      return err(new DomainError("catalog.invalid_id", "Module id cannot be empty"));
    }

    if (!props.assetId || props.assetId.trim().length === 0) {
      return err(new DomainError("catalog.invalid_asset_id", "Module assetId cannot be empty"));
    }

    if (!Number.isInteger(props.version) || props.version < 1) {
      return err(
        new DomainError("catalog.invalid_version", "Module version must be an integer >= 1"),
      );
    }

    if (!props.name || props.name.trim().length === 0) {
      return err(new DomainError("catalog.invalid_name", "Module name cannot be empty"));
    }

    if (!Number.isInteger(props.priceCop) || props.priceCop <= 0) {
      return err(
        new DomainError("catalog.invalid_price", "Module priceCop must be an integer > 0"),
      );
    }

    if (!Number.isFinite(props.areaM2) || props.areaM2 <= 0) {
      return err(new DomainError("catalog.invalid_area", "Module areaM2 must be a number > 0"));
    }

    if (props.widthM !== null && (!Number.isFinite(props.widthM) || props.widthM <= 0)) {
      return err(new DomainError("catalog.invalid_dimension", "Module widthM must be > 0 when provided"));
    }

    if (props.heightM !== null && (!Number.isFinite(props.heightM) || props.heightM <= 0)) {
      return err(new DomainError("catalog.invalid_dimension", "Module heightM must be > 0 when provided"));
    }

    if (props.depthM !== null && (!Number.isFinite(props.depthM) || props.depthM <= 0)) {
      return err(new DomainError("catalog.invalid_dimension", "Module depthM must be > 0 when provided"));
    }

    if (props.status !== "draft") {
      if (!props.glbUrl || props.glbUrl.trim().length === 0) {
        return err(
          new DomainError("catalog.active_missing_glb", "Active module requires glbUrl"),
        );
      }

      if (!props.usdzUrl || props.usdzUrl.trim().length === 0) {
        return err(
          new DomainError("catalog.active_missing_usdz", "Active module requires usdzUrl"),
        );
      }

      if (props.widthM === null || props.heightM === null || props.depthM === null) {
        return err(
          new DomainError(
            "catalog.active_missing_dimensions",
            "Active module requires widthM, heightM and depthM",
          ),
        );
      }
    }

    return ok(new CatalogModule(props));
  }

  get id(): string {
    return this.props.id;
  }

  get assetId(): string {
    return this.props.assetId;
  }

  get version(): number {
    return this.props.version;
  }

  get name(): string {
    return this.props.name;
  }

  get priceCop(): number {
    return this.props.priceCop;
  }

  get areaM2(): number {
    return this.props.areaM2;
  }

  get widthM(): number | null {
    return this.props.widthM;
  }

  get heightM(): number | null {
    return this.props.heightM;
  }

  get depthM(): number | null {
    return this.props.depthM;
  }

  get glbUrl(): string | null {
    return this.props.glbUrl;
  }

  get usdzUrl(): string | null {
    return this.props.usdzUrl;
  }

  get posterUrl(): string | null {
    return this.props.posterUrl;
  }

  get status(): CatalogModuleStatus {
    return this.props.status;
  }

  public isActive(): boolean {
    return this.props.status === "active";
  }
}
