import "server-only";

import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import { getCloudinaryEnv } from "../../../lib/env";
import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import type {
  AssetStoragePort,
  UploadAssetParams,
  UploadAssetResult,
} from "../application/ports/asset-storage.port";

export interface CloudinaryAssetStorageOptions {
  readonly cloudinaryUrl?: string;
}

export class CloudinaryAssetStorage implements AssetStoragePort {
  constructor(options: CloudinaryAssetStorageOptions = {}) {
    const url = options.cloudinaryUrl ?? getCloudinaryEnv().url;
    cloudinary.config({
      cloudinary_url: url,
    });
  }

  async uploadAsset(params: UploadAssetParams): Promise<Result<UploadAssetResult, DomainError>> {
    try {
      const response: UploadApiResponse = await cloudinary.uploader.upload(params.filePath, {
        public_id: params.publicId,
        resource_type: params.resourceType,
        overwrite: params.overwrite ?? false,
        ...(params.assetFolder ? { asset_folder: params.assetFolder } : {}),
      });

      if (!response.secure_url) {
        return err(
          new DomainError("catalog.cloudinary_missing_url", "Cloudinary response did not return secure_url"),
        );
      }

      return ok({
        secureUrl: response.secure_url,
        publicId: response.public_id,
        bytes: response.bytes,
      });
    } catch (error) {
      const errObj = error as { message?: string; error?: { message?: string } };
      const message =
        errObj?.error?.message ??
        errObj?.message ??
        (error instanceof Error ? error.message : "Cloudinary upload failed");
      return err(
        new DomainError("catalog.cloudinary_upload_error", message, {
          cause: error,
        }),
      );
    }
  }
}
