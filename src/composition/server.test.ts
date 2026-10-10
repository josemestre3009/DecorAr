import { describe, expect, it, vi } from "vitest";

import { CatalogController } from "@/interfaces/catalog/catalog-controller";
import { type CatalogRepository } from "@/modules/catalog/application/ports/catalog-repository.port";
import { CatalogModule } from "@/modules/catalog/domain/catalog-module";
import { createAdminClient } from "@/infrastructure/supabase/admin";
import { ConsumePackageChangedEvent } from "@/modules/budget/application/consume-package-changed-event.use-case";
import { GetBudgetUseCase } from "@/modules/budget/application/get-budget.use-case";
import { DrainOutboxUseCase } from "@/modules/events/application/drain-outbox.use-case";
import { SupabaseEventOutbox } from "@/modules/events/infrastructure/supabase-event-outbox";
import { ok } from "@/shared/domain/result";
import { AuthorizePackageAccessUseCase } from "@/modules/packages/application/authorize-package-access.use-case";
import {
  createBudgetConsumerDependencies,
  createBudgetQueryDependencies,
  createCatalogController,
  createEventOutboxDependencies,
  createPackageAccessDependencies,
} from "./server";

vi.mock("server-only", () => ({}));
vi.mock("@/infrastructure/supabase/server", () => ({
  createClient: vi.fn(async () => ({})),
}));
vi.mock("@/infrastructure/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ admin: true })),
}));

describe("composition root server", () => {
  it("creates a CatalogController with injected dependencies", async () => {
    const mockRepository: CatalogRepository = {
      getActiveModules: vi.fn(async () => ok<CatalogModule[]>([])),
    };

    const controller = await createCatalogController(mockRepository);

    expect(controller).toBeInstanceOf(CatalogController);
  });

  it("wires the event outbox and drainer with the service-role client", () => {
    const { drainOutbox, outbox } = createEventOutboxDependencies();

    expect(createAdminClient).toHaveBeenCalledTimes(1);
    expect(outbox).toBeInstanceOf(SupabaseEventOutbox);
    expect(drainOutbox).toBeInstanceOf(DrainOutboxUseCase);
  });

  it("wires package access with the session client, never service_role", async () => {
    vi.mocked(createAdminClient).mockClear();

    const { authorizePackageAccess } = await createPackageAccessDependencies();

    expect(authorizePackageAccess).toBeInstanceOf(AuthorizePackageAccessUseCase);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("wires the budget consumer with the service-role client", () => {
    vi.mocked(createAdminClient).mockClear();

    const { consumePackageChangedEvent } = createBudgetConsumerDependencies();

    expect(createAdminClient).toHaveBeenCalledTimes(1);
    expect(consumePackageChangedEvent).toBeInstanceOf(ConsumePackageChangedEvent);
  });

  it("wires the budget query with the session client, never service_role", async () => {
    vi.mocked(createAdminClient).mockClear();

    const { getBudget } = await createBudgetQueryDependencies();

    expect(getBudget).toBeInstanceOf(GetBudgetUseCase);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
