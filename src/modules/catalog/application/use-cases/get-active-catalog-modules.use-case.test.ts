import { describe, expect, it } from "vitest";

import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../../shared/domain/result";
import { CatalogModule } from "../../domain/catalog-module";
import { type CatalogRepository } from "../ports/catalog-repository.port";
import { GetActiveCatalogModulesUseCase } from "./get-active-catalog-modules.use-case";

class InMemoryCatalogRepository implements CatalogRepository {
  constructor(
    private readonly modules: CatalogModule[] = [],
    private readonly failureError: DomainError | null = null,
  ) {}

  async getActiveModules(): Promise<Result<CatalogModule[], DomainError>> {
    if (this.failureError) {
      return err(this.failureError);
    }
    return ok(this.modules);
  }
}

describe("GetActiveCatalogModulesUseCase", () => {
  it("returns mapped camelCase DTOs for active modules", async () => {
    const activeModule = CatalogModule.create({
      id: "c1000000-0000-4000-8000-000000000001",
      assetId: "mesa",
      version: 1,
      name: "Mesa redonda",
      priceCop: 250000,
      areaM2: 4,
      widthM: 2,
      heightM: 1,
      depthM: 2,
      glbUrl: "https://example.com/mesa.glb",
      usdzUrl: "https://example.com/mesa.usdz",
      posterUrl: "https://example.com/mesa.webp",
      status: "active",
    });

    expect(activeModule.ok).toBe(true);
    if (!activeModule.ok) return;

    const repository = new InMemoryCatalogRepository([activeModule.value]);
    const useCase = new GetActiveCatalogModulesUseCase(repository);

    const result = await useCase.execute();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual([
      {
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
      },
    ]);
  });

  it("omits draft modules if returned by repository", async () => {
    const draftModule = CatalogModule.create({
      id: "c1000000-0000-4000-8000-000000000002",
      assetId: "arco",
      version: 1,
      name: "Arco floral",
      priceCop: 200000,
      areaM2: 2,
      widthM: null,
      heightM: null,
      depthM: null,
      glbUrl: null,
      usdzUrl: null,
      posterUrl: null,
      status: "draft",
    });

    expect(draftModule.ok).toBe(true);
    if (!draftModule.ok) return;

    const repository = new InMemoryCatalogRepository([draftModule.value]);
    const useCase = new GetActiveCatalogModulesUseCase(repository);

    const result = await useCase.execute();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual([]);
  });

  it("propagates repository failures as DomainError", async () => {
    const error = new DomainError("catalog.persistence_failure", "Database connection lost");
    const repository = new InMemoryCatalogRepository([], error);
    const useCase = new GetActiveCatalogModulesUseCase(repository);

    const result = await useCase.execute();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("catalog.persistence_failure");
    expect(result.error.message).toBe("Database connection lost");
  });
});
