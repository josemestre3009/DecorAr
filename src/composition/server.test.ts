import { describe, expect, it, vi } from "vitest";

import { CatalogController } from "../interfaces/catalog/catalog-controller";
import { type CatalogRepository } from "../modules/catalog/application/ports/catalog-repository.port";
import { CatalogModule } from "../modules/catalog/domain/catalog-module";
import { ok } from "../shared/domain/result";
import { createCatalogController } from "./server";

vi.mock("server-only", () => ({}));
vi.mock("../infrastructure/supabase/server", () => ({
  createClient: vi.fn(async () => ({})),
}));

describe("composition root server", () => {
  it("creates a CatalogController with injected dependencies", async () => {
    const mockRepository: CatalogRepository = {
      getActiveModules: vi.fn(async () => ok<CatalogModule[]>([])),
    };

    const controller = await createCatalogController(mockRepository);

    expect(controller).toBeInstanceOf(CatalogController);
  });
});
