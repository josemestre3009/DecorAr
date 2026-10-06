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
});
