import type { DomainError } from "../../../../shared/domain/domain-error";
import type { Result } from "../../../../shared/domain/result";

export interface UploadAssetParams {
  readonly filePath: string;
  readonly publicId: string;
  readonly resourceType: "raw" | "image";
  readonly overwrite?: boolean;
  readonly assetFolder?: string;
}

export interface UploadAssetResult {
  readonly secureUrl: string;
  readonly publicId: string;
  readonly bytes: number;
}

export interface AssetStoragePort {
  uploadAsset(params: UploadAssetParams): Promise<Result<UploadAssetResult, DomainError>>;
}
