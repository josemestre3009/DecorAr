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

interface ExistingResourceResponse {
  public_id?: string;
  secure_url?: string;
  url?: string;
  bytes?: number;
}

export class CloudinaryAssetStorage implements AssetStoragePort {
  constructor(options: CloudinaryAssetStorageOptions = {}) {
    const url = options.cloudinaryUrl ?? getCloudinaryEnv().url;
    cloudinary.config({
      cloudinary_url: url,
    });
  }

  async uploadAsset(params: UploadAssetParams): Promise<Result<UploadAssetResult, DomainError>> {
    const publicId = params.destinationPath ?? params.publicId;
    if (!publicId) {
      return err(
        new DomainError("catalog.invalid_destination_path", "destinationPath or publicId is required"),
      );
    }

    const resourceType =
      params.resourceType ??
      (publicId.endsWith(".glb") || publicId.endsWith(".usdz") ? "raw" : "image");
    const ifExists = params.ifExists ?? (params.overwrite === false ? "reuse" : "overwrite");
    const overwrite = ifExists === "overwrite";

    try {
      const response: UploadApiResponse = await cloudinary.uploader.upload(params.filePath, {
        public_id: publicId,
        resource_type: resourceType,
        overwrite,
        ...(params.assetFolder ? { asset_folder: params.assetFolder } : {}),
      });

      if (!response.secure_url || (response as { existing?: boolean }).existing) {
        if (ifExists === "reuse") {
          return await this.fetchExistingResource(publicId, resourceType);
        }
        return err(
          new DomainError("catalog.cloudinary_missing_url", "Cloudinary response did not return secure_url"),
        );
      }

      return ok({
        secureUrl: response.secure_url,
        publicUrl: response.secure_url,
        publicId: response.public_id,
        destinationPath: response.public_id,
        bytes: response.bytes,
      });
    } catch (error) {
      const errObj = error as { message?: string; error?: { message?: string; http_code?: number } };
      const message =
        errObj?.error?.message ??
        errObj?.message ??
        (error instanceof Error ? error.message : "Cloudinary upload failed");

      const isAlreadyExistsError =
        message.toLowerCase().includes("already exists") ||
        message.toLowerCase().includes("resource exists") ||
        errObj?.error?.http_code === 409;

      if (isAlreadyExistsError && ifExists === "reuse") {
        return await this.fetchExistingResource(publicId, resourceType);
      }

      return err(
        new DomainError("catalog.cloudinary_upload_error", message, {
          cause: error,
        }),
      );
    }
  }

  private async fetchExistingResource(
    publicId: string,
    resourceType: "raw" | "image",
  ): Promise<Result<UploadAssetResult, DomainError>> {
    try {
      const resource = (await cloudinary.api.resource(publicId, {
        resource_type: resourceType,
      })) as ExistingResourceResponse;

      const secureUrl = resource.secure_url ?? resource.url;
      if (!secureUrl) {
        return err(
          new DomainError(
            "catalog.cloudinary_missing_url",
            `Existing Cloudinary resource '${publicId}' did not return a secure URL`,
          ),
        );
      }

      return ok({
        secureUrl,
        publicUrl: secureUrl,
        publicId: resource.public_id ?? publicId,
        destinationPath: resource.public_id ?? publicId,
        bytes: resource.bytes ?? 0,
      });
    } catch (apiError) {
      const errObj = apiError as { message?: string; error?: { message?: string } };
      const message =
        errObj?.error?.message ??
        errObj?.message ??
        (apiError instanceof Error ? apiError.message : "Failed to fetch existing Cloudinary resource");

      return err(
        new DomainError("catalog.cloudinary_upload_error", message, {
          cause: apiError,
        }),
      );
    }
  }
}
