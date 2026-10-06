import "server-only";

import { createAdminClient } from "@/infrastructure/supabase/admin";
import { createClient, type SessionClientOptions } from "@/infrastructure/supabase/server";
import { createSessionGateway } from "@/infrastructure/supabase/session-gateway";
import { CatalogController } from "@/interfaces/catalog/catalog-controller";
import { type AssetStoragePort } from "@/modules/catalog/application/ports/asset-storage.port";
import { type CatalogActivationPort } from "@/modules/catalog/application/ports/catalog-activation.port";
import { type CatalogRepository } from "@/modules/catalog/application/ports/catalog-repository.port";
import { type FileInspectorPort } from "@/modules/catalog/application/ports/file-inspector.port";
import { GetActiveCatalogModulesUseCase } from "@/modules/catalog/application/use-cases/get-active-catalog-modules.use-case";
import { PublishAndActivateModuleUseCase } from "@/modules/catalog/application/use-cases/publish-and-activate-module.use-case";
import { CloudinaryAssetStorage } from "@/modules/catalog/infrastructure/cloudinary-asset-storage";
import { NodeFileInspector } from "@/modules/catalog/infrastructure/node-file-inspector";
import { SupabaseCatalogActivationAdapter } from "@/modules/catalog/infrastructure/supabase-catalog-activation.adapter";
import { SupabaseCatalogRepository } from "@/modules/catalog/infrastructure/supabase-catalog-repository";
import { createAuthUseCases } from "@/shared/application/auth";

/**
 * El cliente de Supabase se queda aquí dentro a propósito: la única puerta de
 * acceso a la sesión en código de servidor son los casos de uso, de modo que
 * ninguna interfaz puede saltarse `SessionGateway` y leer cookies sin validar.
 */
export async function createSessionDependencies(options: SessionClientOptions = {}) {
  const supabase = await createClient(options);

  return { auth: createAuthUseCases(createSessionGateway(supabase)) };
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

export function createPublishAndActivateModuleUseCase(options?: {
  assetStorage?: AssetStoragePort;
  activationPort?: CatalogActivationPort;
  fileInspector?: FileInspectorPort;
}): PublishAndActivateModuleUseCase {
  const assetStorage = options?.assetStorage ?? new CloudinaryAssetStorage();
  const activationPort =
    options?.activationPort ?? new SupabaseCatalogActivationAdapter(createAdminClient());
  const fileInspector = options?.fileInspector ?? new NodeFileInspector();

  return new PublishAndActivateModuleUseCase(assetStorage, activationPort, fileInspector);
}

