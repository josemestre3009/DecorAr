import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../../shared/domain/result";
import type { CatalogModule } from "../../domain/catalog-module";
import type { AssetStoragePort } from "../ports/asset-storage.port";
import type { CatalogActivationPort } from "../ports/catalog-activation.port";
import type { FileInspectorPort } from "../ports/file-inspector.port";

export const MAX_3D_ASSET_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_POSTER_BYTES = 1 * 1024 * 1024; // 1 MB

export interface ModuleFilesInput {
  readonly glbPath: string;
  readonly usdzPath: string;
  readonly posterPath: string;
}

export interface ModuleDimensionsInput {
  readonly widthM: number;
  readonly heightM: number;
  readonly depthM: number;
}

export interface PublishAndActivateModuleCommand {
  readonly assetId: string;
  readonly version: number;
  readonly files: ModuleFilesInput;
  readonly dimensions: ModuleDimensionsInput;
}

export interface PublishAndActivateModuleResult {
  readonly module: CatalogModule;
  readonly glbUrl: string;
  readonly usdzUrl: string;
  readonly posterUrl: string;
}

export class PublishAndActivateModuleUseCase {
  constructor(
    private readonly assetStorage: AssetStoragePort,
    private readonly activationPort: CatalogActivationPort,
    private readonly fileInspector: FileInspectorPort,
  ) {}

  async execute(
    command: PublishAndActivateModuleCommand,
  ): Promise<Result<PublishAndActivateModuleResult, DomainError>> {
    // 1. Validar parámetros básicos
    if (!command.assetId || command.assetId.trim().length === 0) {
      return err(new DomainError("catalog.invalid_asset_id", "Asset ID cannot be empty"));
    }

    if (!Number.isInteger(command.version) || command.version < 1) {
      return err(new DomainError("catalog.invalid_version", "Version must be an integer >= 1"));
    }

    const { widthM, heightM, depthM } = command.dimensions;
    if (!Number.isFinite(widthM) || widthM <= 0) {
      return err(new DomainError("catalog.invalid_dimensions", "widthM must be a number > 0"));
    }
    if (!Number.isFinite(heightM) || heightM <= 0) {
      return err(new DomainError("catalog.invalid_dimensions", "heightM must be a number > 0"));
    }
    if (!Number.isFinite(depthM) || depthM <= 0) {
      return err(new DomainError("catalog.invalid_dimensions", "depthM must be a number > 0"));
    }

    // 2. Validar extensiones de archivos
    const { glbPath, usdzPath, posterPath } = command.files;

    if (!glbPath.toLowerCase().endsWith(".glb")) {
      return err(
        new DomainError("catalog.invalid_file_format", `GLB file must have .glb extension: ${glbPath}`),
      );
    }

    if (!usdzPath.toLowerCase().endsWith(".usdz")) {
      return err(
        new DomainError("catalog.invalid_file_format", `USDZ file must have .usdz extension: ${usdzPath}`),
      );
    }

    const isPosterFormatValid = [".webp", ".png", ".jpg", ".jpeg"].some((ext) =>
      posterPath.toLowerCase().endsWith(ext),
    );
    if (!isPosterFormatValid) {
      return err(
        new DomainError(
          "catalog.invalid_file_format",
          `Poster file must be .webp, .png, or .jpg: ${posterPath}`,
        ),
      );
    }

    // 3. Inspeccionar existencia y tamaño de archivos
    const glbMeta = await this.fileInspector.inspect(glbPath);
    if (!glbMeta.exists) {
      return err(new DomainError("catalog.file_not_found", `GLB file not found: ${glbPath}`));
    }
    if (glbMeta.byteSize <= 0) {
      return err(new DomainError("catalog.invalid_file_size", `GLB file is empty: ${glbPath}`));
    }
    if (glbMeta.byteSize > MAX_3D_ASSET_BYTES) {
      return err(
        new DomainError(
          "catalog.file_too_large",
          `GLB file exceeds 15 MB limit: ${glbMeta.byteSize} bytes (max ${MAX_3D_ASSET_BYTES})`,
        ),
      );
    }

    const usdzMeta = await this.fileInspector.inspect(usdzPath);
    if (!usdzMeta.exists) {
      return err(new DomainError("catalog.file_not_found", `USDZ file not found: ${usdzPath}`));
    }
    if (usdzMeta.byteSize <= 0) {
      return err(new DomainError("catalog.invalid_file_size", `USDZ file is empty: ${usdzPath}`));
    }
    if (usdzMeta.byteSize > MAX_3D_ASSET_BYTES) {
      return err(
        new DomainError(
          "catalog.file_too_large",
          `USDZ file exceeds 15 MB limit: ${usdzMeta.byteSize} bytes (max ${MAX_3D_ASSET_BYTES})`,
        ),
      );
    }

    const posterMeta = await this.fileInspector.inspect(posterPath);
    if (!posterMeta.exists) {
      return err(new DomainError("catalog.file_not_found", `Poster file not found: ${posterPath}`));
    }
    if (posterMeta.byteSize <= 0) {
      return err(new DomainError("catalog.invalid_file_size", `Poster file is empty: ${posterPath}`));
    }
    if (posterMeta.byteSize > MAX_POSTER_BYTES) {
      return err(
        new DomainError(
          "catalog.file_too_large",
          `Poster exceeds 1 MB limit: ${posterMeta.byteSize} bytes (max ${MAX_POSTER_BYTES})`,
        ),
      );
    }

    // 4. Subir a almacenamiento externo con public_id versionado e inmutable y carpeta asignada
    const assetFolder = `decorar/${command.assetId}`;
    const glbPublicId = `decorar/${command.assetId}/v${command.version}/${command.assetId}.glb`;
    const usdzPublicId = `decorar/${command.assetId}/v${command.version}/${command.assetId}.usdz`;
    const posterPublicId = `decorar/${command.assetId}/v${command.version}/${command.assetId}-poster`;

    const glbUpload = await this.assetStorage.uploadAsset({
      filePath: glbPath,
      publicId: glbPublicId,
      resourceType: "raw",
      overwrite: false,
      assetFolder,
    });
    if (!glbUpload.ok) {
      return err(
        new DomainError("catalog.upload_failure", `Failed to upload GLB: ${glbUpload.error.message}`, {
          cause: glbUpload.error,
        }),
      );
    }

    const usdzUpload = await this.assetStorage.uploadAsset({
      filePath: usdzPath,
      publicId: usdzPublicId,
      resourceType: "raw",
      overwrite: false,
      assetFolder,
    });
    if (!usdzUpload.ok) {
      return err(
        new DomainError("catalog.upload_failure", `Failed to upload USDZ: ${usdzUpload.error.message}`, {
          cause: usdzUpload.error,
        }),
      );
    }

    const posterUpload = await this.assetStorage.uploadAsset({
      filePath: posterPath,
      publicId: posterPublicId,
      resourceType: "image",
      overwrite: false,
      assetFolder,
    });
    if (!posterUpload.ok) {
      return err(
        new DomainError(
          "catalog.upload_failure",
          `Failed to upload poster: ${posterUpload.error.message}`,
          { cause: posterUpload.error },
        ),
      );
    }

    // 5. Invocación atómica en base de datos
    const activation = await this.activationPort.activateModule({
      assetId: command.assetId,
      version: command.version,
      glbUrl: glbUpload.value.secureUrl,
      usdzUrl: usdzUpload.value.secureUrl,
      posterUrl: posterUpload.value.secureUrl,
      widthM,
      heightM,
      depthM,
    });

    if (!activation.ok) {
      return err(
        new DomainError(
          "catalog.activation_failure",
          `Failed to activate module atomically: ${activation.error.message}`,
          { cause: activation.error },
        ),
      );
    }

    return ok({
      module: activation.value,
      glbUrl: glbUpload.value.secureUrl,
      usdzUrl: usdzUpload.value.secureUrl,
      posterUrl: posterUpload.value.secureUrl,
    });
  }
}
