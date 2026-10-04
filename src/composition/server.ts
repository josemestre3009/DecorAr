import "server-only";

import { createAdminClient } from "../infrastructure/supabase/admin";
import { createClient } from "../infrastructure/supabase/server";
import { CatalogController } from "../interfaces/catalog/catalog-controller";
import { type CatalogRepository } from "../modules/catalog/application/ports/catalog-repository.port";
import { GetActiveCatalogModulesUseCase } from "../modules/catalog/application/use-cases/get-active-catalog-modules.use-case";
import { SupabaseCatalogRepository } from "../modules/catalog/infrastructure/supabase-catalog-repository";

export async function createSessionDependencies() {
  return { supabase: await createClient() };
}

export function createAdminDependencies() {
  return { supabase: createAdminClient() };
}

export async function createCatalogController(
  customRepository?: CatalogRepository,
): Promise<CatalogController> {
  const repository =
    customRepository ?? new SupabaseCatalogRepository(await createClient());
  const useCase = new GetActiveCatalogModulesUseCase(repository);

  return new CatalogController(useCase);
}
