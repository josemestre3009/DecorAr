import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok } from "../../../../shared/domain/result";
import { CatalogModule } from "../../domain/catalog-module";
import type {
  AssetStoragePort,
  UploadAssetParams,
} from "../ports/asset-storage.port";
import type {
  CatalogActivationPort,
} from "../ports/catalog-activation.port";
import type { FileInspectorPort, FileMetadata } from "../ports/file-inspector.port";
import {
  MAX_3D_ASSET_BYTES,
  MAX_POSTER_BYTES,
  PublishAndActivateModuleUseCase,
} from "./publish-and-activate-module.use-case";

function createMockCatalogModule(status: "draft" | "active" = "active") {
  const result = CatalogModule.create({
    id: "test-uuid-1",
    assetId: "mesa",
    version: 1,
    name: "Mesa redonda",
    priceCop: 250000,
    areaM2: 4,
    widthM: 2.0,
    heightM: 1.0,
    depthM: 2.0,
    glbUrl: status === "active" ? "https://res.cloudinary.com/demo/raw/upload/mesa.glb" : null,
    usdzUrl: status === "active" ? "https://res.cloudinary.com/demo/raw/upload/mesa.usdz" : null,
    posterUrl: status === "active" ? "https://res.cloudinary.com/demo/image/upload/mesa.webp" : null,
    status,
  });

  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("PublishAndActivateModuleUseCase", () => {
  const defaultCommand = {
    assetId: "mesa",
    version: 1,
    files: {
      glbPath: "assets/3d/mesa/v1/mesa.glb",
      usdzPath: "assets/3d/mesa/v1/mesa.usdz",
      posterPath: "assets/3d/mesa/v1/poster.webp",
    },
    dimensions: {
      widthM: 2.0,
      heightM: 1.0,
      depthM: 2.0,
    },
  };

  it("rechaza assetId vacío o versión inválida", async () => {
    const storage: AssetStoragePort = { uploadAsset: vi.fn() };
    const activation: CatalogActivationPort = { activateModule: vi.fn() };
    const inspector: FileInspectorPort = { inspect: vi.fn() };

    const useCase = new PublishAndActivateModuleUseCase(storage, activation, inspector);

    const emptyIdRes = await useCase.execute({
      ...defaultCommand,
      assetId: "   ",
    });
    expect(emptyIdRes.ok).toBe(false);
    if (!emptyIdRes.ok) {
      expect(emptyIdRes.error.code).toBe("catalog.invalid_asset_id");
    }

    const invalidVerRes = await useCase.execute({
      ...defaultCommand,
      version: 0,
    });
    expect(invalidVerRes.ok).toBe(false);
    if (!invalidVerRes.ok) {
      expect(invalidVerRes.error.code).toBe("catalog.invalid_version");
    }
  });

  it("rechaza dimensiones no positivas", async () => {
    const storage: AssetStoragePort = { uploadAsset: vi.fn() };
    const activation: CatalogActivationPort = { activateModule: vi.fn() };
    const inspector: FileInspectorPort = { inspect: vi.fn() };

    const useCase = new PublishAndActivateModuleUseCase(storage, activation, inspector);

    const result = await useCase.execute({
      ...defaultCommand,
      dimensions: { widthM: -1, heightM: 1, depthM: 2 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("catalog.invalid_dimensions");
  });

  it("rechaza extensiones de archivos no permitidas", async () => {
    const storage: AssetStoragePort = { uploadAsset: vi.fn() };
    const activation: CatalogActivationPort = { activateModule: vi.fn() };
    const inspector: FileInspectorPort = { inspect: vi.fn() };

    const useCase = new PublishAndActivateModuleUseCase(storage, activation, inspector);

    const badGlb = await useCase.execute({
      ...defaultCommand,
      files: { ...defaultCommand.files, glbPath: "model.obj" },
    });
    expect(badGlb.ok).toBe(false);
    if (!badGlb.ok) {
      expect(badGlb.error.code).toBe("catalog.invalid_file_format");
    }

    const badUsdz = await useCase.execute({
      ...defaultCommand,
      files: { ...defaultCommand.files, usdzPath: "model.dae" },
    });
    expect(badUsdz.ok).toBe(false);
    if (!badUsdz.ok) {
      expect(badUsdz.error.code).toBe("catalog.invalid_file_format");
    }

    const badPoster = await useCase.execute({
      ...defaultCommand,
      files: { ...defaultCommand.files, posterPath: "poster.gif" },
    });
    expect(badPoster.ok).toBe(false);
    if (!badPoster.ok) {
      expect(badPoster.error.code).toBe("catalog.invalid_file_format");
    }
  });

  it("rechaza archivos inexistentes o vacíos", async () => {
    const storage: AssetStoragePort = { uploadAsset: vi.fn() };
    const activation: CatalogActivationPort = { activateModule: vi.fn() };
    const inspector: FileInspectorPort = {
      inspect: vi.fn().mockResolvedValue({ exists: false, byteSize: 0 }),
    };

    const useCase = new PublishAndActivateModuleUseCase(storage, activation, inspector);

    const notFound = await useCase.execute(defaultCommand);
    expect(notFound.ok).toBe(false);
    if (!notFound.ok) {
      expect(notFound.error.code).toBe("catalog.file_not_found");
    }

    const emptyFileInspector: FileInspectorPort = {
      inspect: vi.fn().mockResolvedValue({ exists: true, byteSize: 0 }),
    };
    const useCaseEmpty = new PublishAndActivateModuleUseCase(
      storage,
      activation,
      emptyFileInspector,
    );

    const emptyRes = await useCaseEmpty.execute(defaultCommand);
    expect(emptyRes.ok).toBe(false);
    if (!emptyRes.ok) {
      expect(emptyRes.error.code).toBe("catalog.invalid_file_size");
    }
  });

  it("rechaza modelos 3D que excedan el límite operativo de 10 MiB", async () => {
    const storage: AssetStoragePort = { uploadAsset: vi.fn() };
    const activation: CatalogActivationPort = { activateModule: vi.fn() };
    const inspector: FileInspectorPort = {
      inspect: vi.fn().mockImplementation(async (path: string): Promise<FileMetadata> => {
        if (path.endsWith(".glb")) {
          return { exists: true, byteSize: MAX_3D_ASSET_BYTES + 1 };
        }
        return { exists: true, byteSize: 1024 };
      }),
    };

    const useCase = new PublishAndActivateModuleUseCase(storage, activation, inspector);

    const result = await useCase.execute(defaultCommand);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("catalog.file_too_large");
    expect(result.error.message).toContain("10 MiB");
  });

  it("rechaza posters que excedan el límite de 1 MB", async () => {
    const storage: AssetStoragePort = { uploadAsset: vi.fn() };
    const activation: CatalogActivationPort = { activateModule: vi.fn() };
    const inspector: FileInspectorPort = {
      inspect: vi.fn().mockImplementation(async (path: string): Promise<FileMetadata> => {
        if (path.endsWith(".webp")) {
          return { exists: true, byteSize: MAX_POSTER_BYTES + 1 };
        }
        return { exists: true, byteSize: 1024 };
      }),
    };

    const useCase = new PublishAndActivateModuleUseCase(storage, activation, inspector);

    const result = await useCase.execute(defaultCommand);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("catalog.file_too_large");
    expect(result.error.message).toContain("1 MB");
  });

  it("garantiza que ante un fallo de subida parcial, la base de datos NUNCA es tocada (cero estado parcial)", async () => {
    const storage: AssetStoragePort = {
      uploadAsset: vi.fn().mockImplementation(async (params: UploadAssetParams) => {
        if (params.filePath.endsWith(".usdz")) {
          return err(new DomainError("storage.network_error", "Simulated USDZ upload drop"));
        }
        return ok({
          secureUrl: "https://res.cloudinary.com/demo/raw/upload/file",
          publicId: params.publicId,
          bytes: 1024,
        });
      }),
    };
    const activation: CatalogActivationPort = {
      activateModule: vi.fn(),
    };
    const inspector: FileInspectorPort = {
      inspect: vi.fn().mockResolvedValue({ exists: true, byteSize: 2048 }),
    };

    const useCase = new PublishAndActivateModuleUseCase(storage, activation, inspector);

    const result = await useCase.execute(defaultCommand);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("catalog.upload_failure");

    // CRÍTICO: La base de datos nunca debió ser invocada
    expect(activation.activateModule).not.toHaveBeenCalled();
  });

  it("sube GLB/USDZ como raw y poster como image con public_id versionado e inmutable (overwrite: false)", async () => {
    const uploadedParams: UploadAssetParams[] = [];
    const storage: AssetStoragePort = {
      uploadAsset: vi.fn().mockImplementation(async (params: UploadAssetParams) => {
        uploadedParams.push(params);
        return ok({
          secureUrl: `https://res.cloudinary.com/demo/${params.resourceType}/upload/${params.publicId}`,
          publicId: params.publicId,
          bytes: 4096,
        });
      }),
    };

    const activation: CatalogActivationPort = {
      activateModule: vi.fn().mockResolvedValue(ok(createMockCatalogModule("active"))),
    };

    const inspector: FileInspectorPort = {
      inspect: vi.fn().mockResolvedValue({ exists: true, byteSize: 5000 }),
    };

    const useCase = new PublishAndActivateModuleUseCase(storage, activation, inspector);

    const result = await useCase.execute(defaultCommand);
    expect(result.ok).toBe(true);

    expect(uploadedParams).toHaveLength(3);
    // GLB
    expect(uploadedParams[0].resourceType).toBe("raw");
    expect(uploadedParams[0].overwrite).toBe(false);
    expect(uploadedParams[0].publicId).toBe("decorar/mesa/v1/mesa.glb");

    // USDZ
    expect(uploadedParams[1].resourceType).toBe("raw");
    expect(uploadedParams[1].overwrite).toBe(false);
    expect(uploadedParams[1].publicId).toBe("decorar/mesa/v1/mesa.usdz");

    // Poster
    expect(uploadedParams[2].resourceType).toBe("image");
    expect(uploadedParams[2].overwrite).toBe(false);
    expect(uploadedParams[2].publicId).toBe("decorar/mesa/v1/mesa-poster");

    // Activación atómica con URLs HTTPS
    expect(activation.activateModule).toHaveBeenCalledWith({
      assetId: "mesa",
      version: 1,
      glbUrl: expect.stringMatching(/^https:\/\//),
      usdzUrl: expect.stringMatching(/^https:\/\//),
      posterUrl: expect.stringMatching(/^https:\/\//),
      widthM: 2.0,
      heightM: 1.0,
      depthM: 2.0,
    });
  });

  it("inmutable: publicar versión 2 conserva los parámetros de versionado v2 sin afectar v1", async () => {
    const uploadedParams: UploadAssetParams[] = [];
    const storage: AssetStoragePort = {
      uploadAsset: vi.fn().mockImplementation(async (params: UploadAssetParams) => {
        uploadedParams.push(params);
        return ok({
          secureUrl: `https://res.cloudinary.com/demo/${params.resourceType}/upload/${params.publicId}`,
          publicId: params.publicId,
          bytes: 4096,
        });
      }),
    };

    const activation: CatalogActivationPort = {
      activateModule: vi.fn().mockResolvedValue(ok(createMockCatalogModule("active"))),
    };

    const inspector: FileInspectorPort = {
      inspect: vi.fn().mockResolvedValue({ exists: true, byteSize: 5000 }),
    };

    const useCase = new PublishAndActivateModuleUseCase(storage, activation, inspector);

    const v2Command = {
      ...defaultCommand,
      version: 2,
    };

    const result = await useCase.execute(v2Command);
    expect(result.ok).toBe(true);

    expect(uploadedParams[0].publicId).toBe("decorar/mesa/v2/mesa.glb");
    expect(uploadedParams[1].publicId).toBe("decorar/mesa/v2/mesa.usdz");
    expect(uploadedParams[2].publicId).toBe("decorar/mesa/v2/mesa-poster");
  });

  it("retorna DomainError si la activación atómica en base de datos falla", async () => {
    const storage: AssetStoragePort = {
      uploadAsset: vi.fn().mockImplementation(async (params: UploadAssetParams) => {
        return ok({
          secureUrl: `https://res.cloudinary.com/demo/raw/upload/${params.publicId}`,
          publicId: params.publicId ?? "mock-id",
          bytes: 4096,
        });
      }),
    };

    const activation: CatalogActivationPort = {
      activateModule: vi.fn().mockResolvedValue(
        err(new DomainError("catalog.activation_error", "Catalog module with asset_id mesa and version 1 is not in draft status")),
      ),
    };

    const inspector: FileInspectorPort = {
      inspect: vi.fn().mockResolvedValue({ exists: true, byteSize: 5000 }),
    };

    const useCase = new PublishAndActivateModuleUseCase(storage, activation, inspector);

    const result = await useCase.execute(defaultCommand);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("catalog.activation_failure");
    expect(result.error.message).toContain("is not in draft status");
  });

  it("idempotente: reejecutar la publicación con activos existentes en storage activa el módulo exitosamente", async () => {
    const storage: AssetStoragePort = {
      uploadAsset: vi.fn().mockImplementation(async (params: UploadAssetParams) => {
        // Simulates reusing existing assets
        return ok({
          secureUrl: `https://res.cloudinary.com/demo/raw/upload/${params.destinationPath ?? params.publicId}`,
          publicUrl: `https://res.cloudinary.com/demo/raw/upload/${params.destinationPath ?? params.publicId}`,
          publicId: params.destinationPath ?? params.publicId ?? "mock",
          destinationPath: params.destinationPath ?? params.publicId,
          bytes: 4096,
        });
      }),
    };

    const activation: CatalogActivationPort = {
      activateModule: vi.fn().mockResolvedValue(ok(createMockCatalogModule("active"))),
    };

    const inspector: FileInspectorPort = {
      inspect: vi.fn().mockResolvedValue({ exists: true, byteSize: 5000 }),
    };

    const useCase = new PublishAndActivateModuleUseCase(storage, activation, inspector);

    const result = await useCase.execute(defaultCommand);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.module.status).toBe("active");
    expect(activation.activateModule).toHaveBeenCalledTimes(1);
  });
});
