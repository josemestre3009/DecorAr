import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../shared/domain/domain-error";
import { err, ok } from "../../shared/domain/result";
import { type CatalogModuleDto } from "../../modules/catalog/application/dtos/catalog-module.dto";
import { type GetActiveCatalogModulesUseCase } from "../../modules/catalog/application/use-cases/get-active-catalog-modules.use-case";
import { CatalogController } from "./catalog-controller";

describe("CatalogController", () => {
  const sampleDto: CatalogModuleDto = {
    id: "c1000000-0000-4000-8000-000000000001",
    name: "Mesa redonda",
    priceCop: 250000,
    areaM2: 4,
    widthM: 2,
    heightM: 1,
    depthM: 2,
    glbUrl: "https://example.com/mesa.glb",
    usdzUrl: "https://example.com/mesa.usdz",
    posterUrl: "https://example.com/mesa.webp",
    assetId: "mesa",
    version: 1,
  };

  it("returns 200 with json payload on success", async () => {
    const mockUseCase = {
      execute: vi.fn().mockResolvedValue(ok([sampleDto])),
    } as unknown as GetActiveCatalogModulesUseCase;

    const controller = new CatalogController(mockUseCase);
    const response = await controller.handleGetModules();

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual([sampleDto]);
  });

  it("returns 500 with correlationId when use case fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockUseCase = {
      execute: vi.fn().mockResolvedValue(err(new DomainError("db.failure", "DB query error"))),
    } as unknown as GetActiveCatalogModulesUseCase;

    const controller = new CatalogController(mockUseCase);
    const response = await controller.handleGetModules();

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json).toHaveProperty("error", "Internal Server Error");
    expect(json).toHaveProperty("correlationId");
    expect(json).not.toHaveProperty("cause");
    expect(json).not.toHaveProperty("message");

    consoleErrorSpy.mockRestore();
  });

  it("returns 500 with correlationId when use case throws unexpectedly", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockUseCase = {
      execute: vi.fn().mockRejectedValue(new Error("Fatal explosion")),
    } as unknown as GetActiveCatalogModulesUseCase;

    const controller = new CatalogController(mockUseCase);
    const response = await controller.handleGetModules();

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json).toHaveProperty("error", "Internal Server Error");
    expect(json).toHaveProperty("correlationId");

    consoleErrorSpy.mockRestore();
  });
});
