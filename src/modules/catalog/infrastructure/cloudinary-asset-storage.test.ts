import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import { CloudinaryAssetStorage } from "./cloudinary-asset-storage";

vi.mock("cloudinary", () => ({
  v2: {
    config: vi.fn(),
    uploader: {
      upload: vi.fn(),
    },
    api: {
      resource: vi.fn(),
    },
  },
}));

describe("CloudinaryAssetStorage", () => {
  const originalEnv = process.env.CLOUDINARY_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLOUDINARY_URL = "cloudinary://mock_key:mock_secret@mock_cloud";
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CLOUDINARY_URL = originalEnv;
    } else {
      delete process.env.CLOUDINARY_URL;
    }
  });

  it("configura la url de Cloudinary si se proporciona en opciones", () => {
    new CloudinaryAssetStorage({
      cloudinaryUrl: "cloudinary://123:abc@testcloud",
    });

    expect(cloudinary.config).toHaveBeenCalledWith({
      cloudinary_url: "cloudinary://123:abc@testcloud",
    });
  });

  it("sube recurso raw y retorna secure_url y bytes", async () => {
    vi.mocked(cloudinary.uploader.upload).mockResolvedValue({
      public_id: "decorar/mesa/v1/mesa.glb",
      secure_url: "https://res.cloudinary.com/testcloud/raw/upload/decorar/mesa/v1/mesa.glb",
      bytes: 2048,
    } as unknown as UploadApiResponse);

    const storage = new CloudinaryAssetStorage();
    const result = await storage.uploadAsset({
      filePath: "/path/to/mesa.glb",
      publicId: "decorar/mesa/v1/mesa.glb",
      resourceType: "raw",
      overwrite: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.secureUrl).toBe(
      "https://res.cloudinary.com/testcloud/raw/upload/decorar/mesa/v1/mesa.glb",
    );
    expect(result.value.bytes).toBe(2048);
    expect(cloudinary.uploader.upload).toHaveBeenCalledWith("/path/to/mesa.glb", {
      public_id: "decorar/mesa/v1/mesa.glb",
      resource_type: "raw",
      overwrite: false,
    });
  });

  it("reenvía asset_folder cuando se proporciona", async () => {
    vi.mocked(cloudinary.uploader.upload).mockResolvedValue({
      public_id: "decorar/mesa/v1/mesa.glb",
      secure_url: "https://res.cloudinary.com/testcloud/raw/upload/decorar/mesa/v1/mesa.glb",
      bytes: 2048,
    } as unknown as UploadApiResponse);

    const storage = new CloudinaryAssetStorage();
    await storage.uploadAsset({
      filePath: "/path/to/mesa.glb",
      publicId: "decorar/mesa/v1/mesa.glb",
      resourceType: "raw",
      overwrite: false,
      assetFolder: "decorar/mesa",
    });

    expect(cloudinary.uploader.upload).toHaveBeenCalledWith("/path/to/mesa.glb", {
      public_id: "decorar/mesa/v1/mesa.glb",
      resource_type: "raw",
      overwrite: false,
      asset_folder: "decorar/mesa",
    });
  });

  it("retorna DomainError si Cloudinary falla", async () => {
    vi.mocked(cloudinary.uploader.upload).mockRejectedValue(new Error("API rate limit exceeded"));

    const storage = new CloudinaryAssetStorage();
    const result = await storage.uploadAsset({
      filePath: "/path/to/mesa.glb",
      publicId: "decorar/mesa/v1/mesa.glb",
      resourceType: "raw",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("catalog.cloudinary_upload_error");
    expect(result.error.message).toContain("API rate limit exceeded");
  });

  it("recupera metadatos con api.resource cuando la subida devuelve existing: true (idempotente)", async () => {
    vi.mocked(cloudinary.uploader.upload).mockResolvedValue({
      public_id: "decorar/mesa/v1/mesa.glb",
      existing: true,
    } as unknown as UploadApiResponse);

    vi.mocked(cloudinary.api.resource).mockResolvedValue({
      public_id: "decorar/mesa/v1/mesa.glb",
      secure_url: "https://res.cloudinary.com/testcloud/raw/upload/decorar/mesa/v1/mesa.glb",
      bytes: 2048,
    });

    const storage = new CloudinaryAssetStorage();
    const result = await storage.uploadAsset({
      filePath: "/path/to/mesa.glb",
      destinationPath: "decorar/mesa/v1/mesa.glb",
      resourceType: "raw",
      ifExists: "reuse",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.secureUrl).toBe(
      "https://res.cloudinary.com/testcloud/raw/upload/decorar/mesa/v1/mesa.glb",
    );
    expect(result.value.bytes).toBe(2048);
    expect(cloudinary.api.resource).toHaveBeenCalledWith("decorar/mesa/v1/mesa.glb", {
      resource_type: "raw",
    });
  });

  it("recupera metadatos cuando la subida lanza error de que el recurso ya existe y ifExists es reuse", async () => {
    vi.mocked(cloudinary.uploader.upload).mockRejectedValue(
      new Error("Resource decorar/mesa/v1/mesa.glb already exists"),
    );

    vi.mocked(cloudinary.api.resource).mockResolvedValue({
      public_id: "decorar/mesa/v1/mesa.glb",
      secure_url: "https://res.cloudinary.com/testcloud/raw/upload/decorar/mesa/v1/mesa.glb",
      bytes: 4096,
    });

    const storage = new CloudinaryAssetStorage();
    const result = await storage.uploadAsset({
      filePath: "/path/to/mesa.glb",
      publicId: "decorar/mesa/v1/mesa.glb",
      resourceType: "raw",
      overwrite: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.secureUrl).toBe(
      "https://res.cloudinary.com/testcloud/raw/upload/decorar/mesa/v1/mesa.glb",
    );
    expect(result.value.bytes).toBe(4096);
    expect(cloudinary.api.resource).toHaveBeenCalledWith("decorar/mesa/v1/mesa.glb", {
      resource_type: "raw",
    });
  });

  it("retorna DomainError si el recurso existente no devuelve secure_url", async () => {
    vi.mocked(cloudinary.uploader.upload).mockResolvedValue({
      public_id: "decorar/mesa/v1/mesa.glb",
      existing: true,
    } as unknown as UploadApiResponse);

    vi.mocked(cloudinary.api.resource).mockResolvedValue({
      public_id: "decorar/mesa/v1/mesa.glb",
      bytes: 2048,
    });

    const storage = new CloudinaryAssetStorage();
    const result = await storage.uploadAsset({
      filePath: "/path/to/mesa.glb",
      destinationPath: "decorar/mesa/v1/mesa.glb",
      resourceType: "raw",
      ifExists: "reuse",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("catalog.cloudinary_missing_url");
  });
});
