import { err, ok, type Result } from "@/shared/domain/result";

import {
  networkFailure,
  readApiError,
  unexpectedResponseFailure,
  type ApiFailure,
} from "./api-error";
import {
  createSimulatedPackagesClient,
  resolvePackagesMode,
  type PackagesClientMode,
} from "./packages-client";
import { validateEventName } from "./space-definition";

/**
 * Plantillas privadas de eventos (DECOR-44). Contrato HTTP:
 *
 * - `GET /api/event-templates` → `{templates:[...]}` (o un arreglo)
 * - `POST /api/event-templates {packageId, name}` → 201 plantilla
 * - `PATCH /api/event-templates/{id} {name}` → 200 plantilla
 * - `DELETE /api/event-templates/{id}` → 204
 * - `POST /api/event-templates/{id}/instantiate {name}` → 201 evento
 */

export const EVENT_TEMPLATES_ENDPOINT = "/api/event-templates";

export type EventTemplateSummary = {
  readonly id: string;
  readonly name: string;
  readonly updatedAt?: string;
  readonly itemCount?: number;
};

export type InstantiatedEvent = {
  readonly id: string;
  readonly name: string;
};

export interface EventTemplatesClient {
  readonly mode: PackagesClientMode;
  list(): Promise<Result<readonly EventTemplateSummary[], ApiFailure>>;
  createFromEvent(packageId: string, name: string): Promise<Result<EventTemplateSummary, ApiFailure>>;
  rename(templateId: string, name: string): Promise<Result<EventTemplateSummary, ApiFailure>>;
  remove(templateId: string): Promise<Result<void, ApiFailure>>;
  instantiate(templateId: string, name: string): Promise<Result<InstantiatedEvent, ApiFailure>>;
}

export function isEventTemplateSummary(value: unknown): value is EventTemplateSummary {
  if (typeof value !== "object" || value === null) return false;

  const body = value as Record<string, unknown>;

  return typeof body.id === "string" && typeof body.name === "string";
}

function isInstantiatedEvent(value: unknown): value is InstantiatedEvent {
  if (typeof value !== "object" || value === null) return false;

  const body = value as Record<string, unknown>;
  return typeof body.id === "string" && typeof body.name === "string";
}

function readTemplateList(body: unknown): readonly EventTemplateSummary[] | null {
  const list = Array.isArray(body)
    ? body
    : typeof body === "object" && body !== null && Array.isArray((body as Record<string, unknown>).templates)
      ? ((body as Record<string, unknown>).templates as unknown[])
      : null;

  return list && list.every(isEventTemplateSummary) ? (list as EventTemplateSummary[]) : null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export function createHttpEventTemplatesClient(fetcher: typeof fetch = fetch): EventTemplatesClient {
  const expectStatus = (response: Response, status: number) =>
    response.ok && response.status === status;

  return {
    mode: "live",
    async list() {
      let response: Response;
      try {
        response = await fetcher(EVENT_TEMPLATES_ENDPOINT, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
      } catch {
        return err(networkFailure());
      }

      if (!response.ok) {
        return err(await readApiError(response));
      }

      const list = readTemplateList(await readJson(response));

      return list ? ok(list) : err(unexpectedResponseFailure(response.status));
    },
    async createFromEvent(packageId, name) {
      let response: Response;
      try {
        response = await fetcher(EVENT_TEMPLATES_ENDPOINT, {
          body: JSON.stringify({ name, packageId }),
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          method: "POST",
        });
      } catch {
        return err(networkFailure());
      }

      if (!expectStatus(response, 201)) {
        return err(response.ok ? unexpectedResponseFailure(response.status) : await readApiError(response));
      }

      const body = await readJson(response);

      return isEventTemplateSummary(body) ? ok(body) : err(unexpectedResponseFailure(response.status));
    },
    async rename(templateId, name) {
      let response: Response;
      try {
        response = await fetcher(`${EVENT_TEMPLATES_ENDPOINT}/${encodeURIComponent(templateId)}`, {
          body: JSON.stringify({ name }),
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          method: "PATCH",
        });
      } catch {
        return err(networkFailure());
      }

      if (!response.ok || response.status !== 200) {
        return err(response.ok ? unexpectedResponseFailure(response.status) : await readApiError(response));
      }

      const body = await readJson(response);

      return isEventTemplateSummary(body) ? ok(body) : err(unexpectedResponseFailure(response.status));
    },
    async remove(templateId) {
      let response: Response;
      try {
        response = await fetcher(`${EVENT_TEMPLATES_ENDPOINT}/${encodeURIComponent(templateId)}`, {
          headers: { Accept: "application/json" },
          method: "DELETE",
        });
      } catch {
        return err(networkFailure());
      }

      return response.status === 204
        ? ok(undefined)
        : err(response.ok ? unexpectedResponseFailure(response.status) : await readApiError(response));
    },
    async instantiate(templateId, name) {
      let response: Response;
      try {
        response = await fetcher(`${EVENT_TEMPLATES_ENDPOINT}/${encodeURIComponent(templateId)}/instantiate`, {
          body: JSON.stringify({ name }),
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          method: "POST",
        });
      } catch {
        return err(networkFailure());
      }

      if (!expectStatus(response, 201)) {
        return err(response.ok ? unexpectedResponseFailure(response.status) : await readApiError(response));
      }

      const body = await readJson(response);

      return isInstantiatedEvent(body) ? ok(body) : err(unexpectedResponseFailure(response.status));
    },
  };
}

// --- Simulación temporal (hasta que la API esté activa) -------------------

export const SIMULATED_TEMPLATES_STORAGE_KEY = "decorar.simulated-event-templates";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `sim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function failure(kind: ApiFailure["kind"], status: number, code: string, message: string) {
  return err<ApiFailure>({ code, kind, message, status });
}

/**
 * Plantillas en `sessionStorage`, con la misma forma que la API real.
 * `ponytail:` la simulación no copia la configuración del evento (eso lo hace
 * la RPC transaccional en el servidor); suficientes para operar sin API.
 */
export function createSimulatedEventTemplatesClient(
  storage?: KeyValueStorage | null,
  delayMs = 300,
): EventTemplatesClient {
  let memory: EventTemplateSummary[] = [];

  if (storage === undefined && typeof window !== "undefined") {
    try {
      storage = window.sessionStorage;
    } catch {
      storage = null;
    }
  }

  const load = (): EventTemplateSummary[] => {
    try {
      const raw = storage?.getItem(SIMULATED_TEMPLATES_STORAGE_KEY);

      return raw ? (JSON.parse(raw) as EventTemplateSummary[]) : memory;
    } catch {
      return memory;
    }
  };

  const save = (templates: EventTemplateSummary[]) => {
    memory = templates;

    try {
      storage?.setItem(SIMULATED_TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
    } catch {
      // Sin almacenamiento: la simulación sigue en memoria.
    }
  };

  const wait = () => new Promise((resolve) => setTimeout(resolve, delayMs));

  return {
    mode: "simulated",
    async list() {
      await wait();
      return ok(load());
    },
    async createFromEvent(_packageId, name) {
      await wait();

      const valid = validateEventName(name);
      if (!valid.ok) {
        return failure("invalid", 422, "package.invalid_name", valid.error);
      }

      const created: EventTemplateSummary = {
        id: newId(),
        itemCount: 0,
        name: valid.value,
        updatedAt: new Date().toISOString(),
      };

      save([created, ...load()]);

      return ok(created);
    },
    async rename(templateId, name) {
      await wait();

      const templates = load();
      const current = templates.find((template) => template.id === templateId);
      if (!current) {
        return failure("not_found", 404, "template.not_found", "No encontramos esta plantilla.");
      }

      const valid = validateEventName(name);
      if (!valid.ok) {
        return failure("invalid", 422, "package.invalid_name", valid.error);
      }

      const updated: EventTemplateSummary = { ...current, name: valid.value };
      save(templates.map((template) => (template.id === templateId ? updated : template)));

      return ok(updated);
    },
    async remove(templateId) {
      await wait();

      const templates = load();
      if (!templates.some((template) => template.id === templateId)) {
        return failure("not_found", 404, "template.not_found", "No encontramos esta plantilla.");
      }

      save(templates.filter((template) => template.id !== templateId));

      return ok(undefined);
    },
    async instantiate(templateId, name) {
      await wait();

      if (!load().some((template) => template.id === templateId)) {
        return failure("not_found", 404, "template.not_found", "No encontramos esta plantilla.");
      }

      const packages = createSimulatedPackagesClient(storage ?? null, 0);

      return packages.createPackage({ name });
    },
  };
}

// --- Selección -------------------------------------------------------------

let browserClient: EventTemplatesClient | undefined;

function createConfiguredClient(): EventTemplatesClient {
  return resolvePackagesMode(process.env.NEXT_PUBLIC_DECOR_PACKAGES_API) === "live"
    ? createHttpEventTemplatesClient()
    : createSimulatedEventTemplatesClient();
}

export function getEventTemplatesClient(): EventTemplatesClient {
  if (typeof window === "undefined") {
    return createConfiguredClient();
  }

  browserClient ??= createConfiguredClient();

  return browserClient;
}
