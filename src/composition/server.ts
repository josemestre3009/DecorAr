import "server-only";

import { randomUUID } from "node:crypto";

import { createAdminClient } from "@/infrastructure/supabase/admin";
import { createClient, type SessionClientOptions } from "@/infrastructure/supabase/server";
import { createPackageOwnerReader } from "@/infrastructure/supabase/package-owner-reader";
import { createSessionGateway } from "@/infrastructure/supabase/session-gateway";
import { SupabaseCatalogModuleReader } from "@/infrastructure/supabase/supabase-catalog-module-reader";
import { SupabasePackageReader } from "@/infrastructure/supabase/supabase-package-reader";
import { SupabasePackageRepository } from "@/infrastructure/supabase/supabase-package-repository";
import { CatalogController } from "@/interfaces/catalog/catalog-controller";
import { PackageController } from "@/interfaces/packages/package-controller";
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
import { ConsumePackageChangedEvent } from "@/modules/budget/application/consume-package-changed-event.use-case";
import { GetBudgetUseCase } from "@/modules/budget/application/get-budget.use-case";
import { createSupabaseBudgetReader } from "@/modules/budget/infrastructure/supabase-budget-reader";
import { SupabaseBudgetConsumer } from "@/modules/budget/infrastructure/supabase-budget-consumer";
import { createSupabasePackageSnapshotReader } from "@/modules/budget/infrastructure/supabase-package-snapshot-reader";
import { DrainOutboxUseCase } from "@/modules/events/application/drain-outbox.use-case";
import { SupabaseBroadcastEventPublisher } from "@/modules/events/infrastructure/supabase-broadcast-event-publisher";
import { SupabaseEventOutbox } from "@/modules/events/infrastructure/supabase-event-outbox";
import { AuthorizePackageAccessUseCase } from "@/modules/packages/application/authorize-package-access.use-case";
import { AddModuleToPackageUseCase } from "@/modules/packages/application/use-cases/add-module-to-package.use-case";
import { CreatePackageUseCase } from "@/modules/packages/application/use-cases/create-package.use-case";
import { RemoveModuleFromPackageUseCase } from "@/modules/packages/application/use-cases/remove-module-from-package.use-case";
import { createAuthUseCases } from "@/shared/application/auth";
import type { Clock, IdGenerator } from "@/shared/application/ports";

const systemClock: Clock = { now: () => new Date() };
const uuidGenerator: IdGenerator = { generate: () => randomUUID() };

/**
 * El cliente de Supabase se queda aquí dentro a propósito: la única puerta de
 * acceso a la sesión en código de servidor son los casos de uso, de modo que
 * ninguna interfaz puede saltarse `SessionGateway` y leer cookies sin validar.
 */
export async function createSessionDependencies(options: SessionClientOptions = {}) {
  const supabase = await createClient(options);

  return { auth: createAuthUseCases(createSessionGateway(supabase)) };
}

/**
 * Ownership check for package Route Handlers (DECOR-30). Uses the session
 * client, never service_role, so the owner lookup is also filtered by RLS.
 * Handlers run `checkPackageAccess(authorizePackageAccess, packageId)` before
 * any use case and only then reach the service-role outbox.
 */
export async function createPackageAccessDependencies(options: SessionClientOptions = {}) {
  const supabase = await createClient(options);

  return {
    authorizePackageAccess: new AuthorizePackageAccessUseCase(
      createSessionGateway(supabase),
      createPackageOwnerReader(supabase),
    ),
  };
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

/**
 * Outbox and drainer run with the service-role client because the outbox
 * denies anon/authenticated. Callers must validate the session first and put
 * the session user in the event. DECOR-27 calls `outbox.commit` and then
 * `drainOutbox.execute()` (e.g. inside `after()`); DECOR-31 adds retries.
 */
export function createEventOutboxDependencies() {
  const supabase = createAdminClient();
  const outbox = new SupabaseEventOutbox(supabase);

  return {
    drainOutbox: new DrainOutboxUseCase(outbox, new SupabaseBroadcastEventPublisher(supabase)),
    outbox,
  };
}

/**
 * Controller factory for Package Route Handlers (DECOR-27).
 * Uses the session client for identity and RLS verification, and
 * the service-role client for outbox RPCs and package mutations.
 */
export async function createPackageController(
  options: SessionClientOptions = {},
): Promise<PackageController> {
  const pendingHeaders: Record<string, string> = {};
  const sessionClient = await createClient({
    ...options,
    onHeaders: (headers) => {
      Object.assign(pendingHeaders, headers);
      options.onHeaders?.(headers);
    },
  });

  const sessionGateway = createSessionGateway(sessionClient);
  const packageOwnerReader = createPackageOwnerReader(sessionClient);
  const authorizePackageAccess = new AuthorizePackageAccessUseCase(
    sessionGateway,
    packageOwnerReader,
  );

  const adminClient = createAdminClient();
  const packageRepository = new SupabasePackageRepository(adminClient);
  const packageReader = new SupabasePackageReader(adminClient);
  const catalogReader = new SupabaseCatalogModuleReader(adminClient);
  const { drainOutbox, outbox } = createEventOutboxDependencies();

  const createPackageUseCase = new CreatePackageUseCase(packageRepository);
  const addModuleToPackageUseCase = new AddModuleToPackageUseCase(
    packageReader,
    catalogReader,
    outbox,
    systemClock,
    uuidGenerator,
  );
  const removeModuleFromPackageUseCase = new RemoveModuleFromPackageUseCase(
    packageReader,
    outbox,
    systemClock,
    uuidGenerator,
  );

  return new PackageController(
    sessionGateway,
    authorizePackageAccess,
    createPackageUseCase,
    addModuleToPackageUseCase,
    removeModuleFromPackageUseCase,
    drainOutbox,
    pendingHeaders,
  );
}

/**
 * Budget consumer (DECOR-33): runs with the service-role client because
 * `budgets`/`processed_events` writes and the package reread deny
 * anon/authenticated. Whoever commits a package change (DECOR-27) invokes
 * `consumePackageChangedEvent.execute(event)` with the same event right
 * after `outbox.commit`, so recalculation never depends on Realtime having
 * delivered anything.
 */
export function createBudgetConsumerDependencies() {
  const supabase = createAdminClient();

  return {
    consumePackageChangedEvent: new ConsumePackageChangedEvent(
      createSupabasePackageSnapshotReader(supabase),
      new SupabaseBudgetConsumer(supabase),
      new SupabaseBroadcastEventPublisher(supabase),
      uuidGenerator,
      systemClock,
    ),
  };
}

/**
 * Budget resync (DECOR-33): uses the session client, never service_role, so
 * the read is also filtered by the owner RLS policy on `budgets`. The
 * `GET /api/packages/{id}/budget` handler calls `checkPackageAccess` first.
 */
export async function createBudgetQueryDependencies(options: SessionClientOptions = {}) {
  const supabase = await createClient(options);

  return { getBudget: new GetBudgetUseCase(createSupabaseBudgetReader(supabase)) };
}
