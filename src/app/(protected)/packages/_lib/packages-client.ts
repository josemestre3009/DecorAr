import { err, ok, type Result } from "@/shared/domain/result";
import { MAX_BATCH_QUANTITY } from "@/modules/packages/application/dtos/package.dto";

import {
  networkFailure,
  readApiError,
  unexpectedResponseFailure,
  type ApiFailure,
} from "./api-error";
import {
  isSpaceType,
  isValidCapacity,
  type SpaceDefinition,
  type SpaceType,
} from "./space-definition";

/**
 * Puerto de la interfaz hacia la API de paquetes. El contrato pertenece a
 * DECOR-27; DECOR-20 solo lo consume:
 *
 * - `POST /api/packages {spaceType, capacityM2}` → 201 `{id, spaceType, capacityM2}`
 * - `POST /api/packages/{id}/items {moduleId}` → 201 `{itemId, packageVersion}`
 * - errores `{error:{code,message}}` con 400/404/422
 *
 * Mientras DECOR-27 no exista se usa la implementación simulada. Cuando exista,
 * basta con `NEXT_PUBLIC_DECOR_PACKAGES_API=live`.
 */

export type CreatedPackage = {
  readonly id: string;
  readonly spaceType: SpaceType;
  readonly capacityM2: number;
};

export type AddedItem = {
  readonly itemId: string;
  readonly itemIds?: readonly string[];
  readonly packageVersion: number;
};

export type ClonedPackage = {
  readonly id: string;
  readonly spaceType: SpaceType;
  readonly capacityM2: number;
  readonly style?: string | null;
  readonly colors?: readonly string[];
  readonly notes?: string;
  readonly version?: number;
  readonly itemCount?: number;
};

export type PackagesClientMode = "live" | "simulated";

export interface PackagesClient {
  readonly mode: PackagesClientMode;
  createPackage(definition: SpaceDefinition): Promise<Result<CreatedPackage, ApiFailure>>;
  addItem(packageId: string, moduleId: string, quantity?: number): Promise<Result<AddedItem, ApiFailure>>;
  clonePackage(packageId: string): Promise<Result<ClonedPackage, ApiFailure>>;
  /** `DELETE /api/packages/{id}/items/{itemId}` → 204 sin cuerpo (DECOR-27). */
  removeItem(packageId: string, itemId: string): Promise<Result<void, ApiFailure>>;
}

export const PACKAGES_ENDPOINT = "/api/packages";

function isCreatedPackage(value: unknown): value is CreatedPackage {
  if (typeof value !== "object" || value === null) return false;

  const body = value as Record<string, unknown>;

  return typeof body.id === "string" && isSpaceType(body.spaceType) && isValidCapacity(body.capacityM2);
}

function isAddedItem(value: unknown): value is AddedItem {
  if (typeof value !== "object" || value === null) return false;

  const body = value as Record<string, unknown>;

  return typeof body.itemId === "string" &&
    (body.itemIds === undefined || (Array.isArray(body.itemIds) && body.itemIds.every((id) => typeof id === "string"))) &&
    typeof body.packageVersion === "number";
}

function isClonedPackage(value: unknown): value is ClonedPackage {
  if (typeof value !== "object" || value === null) return false;

  const body = value as Record<string, unknown>;

  return typeof body.id === "string" && isSpaceType(body.spaceType) && isValidCapacity(body.capacityM2);
}

async function postJson<T>(
  fetcher: typeof fetch,
  url: string,
  payload: unknown,
  isExpected: (value: unknown) => value is T,
): Promise<Result<T, ApiFailure>> {
  let response: Response;

  try {
    response = await fetcher(url, {
      body: JSON.stringify(payload),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      method: "POST",
    });
  } catch {
    return err(networkFailure());
  }

  if (response.status !== 201) {
    return err(
      response.ok ? unexpectedResponseFailure(response.status) : await readApiError(response),
    );
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    return err(unexpectedResponseFailure(response.status));
  }

  return isExpected(body) ? ok(body) : err(unexpectedResponseFailure(response.status));
}

async function deleteNoContent(fetcher: typeof fetch, url: string): Promise<Result<void, ApiFailure>> {
  let response: Response;

  try {
    response = await fetcher(url, { headers: { Accept: "application/json" }, method: "DELETE" });
  } catch {
    return err(networkFailure());
  }

  if (response.status === 204) {
    return ok(undefined);
  }

  return err(response.ok ? unexpectedResponseFailure(response.status) : await readApiError(response));
}

export function createHttpPackagesClient(fetcher: typeof fetch = fetch): PackagesClient {
  return {
    mode: "live",
    createPackage: (definition) =>
      postJson(
        fetcher,
        PACKAGES_ENDPOINT,
        { capacityM2: definition.capacityM2, spaceType: definition.spaceType },
        isCreatedPackage,
      ),
    addItem: (packageId, moduleId, quantity = 1) =>
      postJson(
        fetcher,
        `${PACKAGES_ENDPOINT}/${encodeURIComponent(packageId)}/items`,
        quantity === 1 ? { moduleId } : { moduleId, quantity },
        isAddedItem,
      ),
    clonePackage: (packageId) =>
      postJson(
        fetcher,
        `${PACKAGES_ENDPOINT}/${encodeURIComponent(packageId)}/clone`,
        {},
        isClonedPackage,
      ),
    removeItem: (packageId, itemId) =>
      deleteNoContent(
        fetcher,
        `${PACKAGES_ENDPOINT}/${encodeURIComponent(packageId)}/items/${encodeURIComponent(itemId)}`,
      ),
  };
}

// --- Simulación temporal (hasta DECOR-27) ---------------------------------

export const SIMULATED_STORAGE_KEY = "decorar.simulated-packages";

type SimulatedPackage = CreatedPackage & {
  version: number;
  items: { itemId: string; moduleId: string }[];
};

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

function newId(): string {
  // randomUUID solo existe en contextos seguros; al probar desde el celular por
  // la IP de la red local (http) no está disponible.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `sim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function failure(kind: ApiFailure["kind"], status: number, code: string, message: string) {
  return err<ApiFailure>({ code, kind, message, status });
}

/**
 * Responde como lo hará DECOR-27, sin red ni servidor. Los paquetes viven en
 * `sessionStorage`: sobreviven a una recarga, pero no a cerrar la pestaña, y no
 * se comparan con el área de los módulos (eso es del Builder de DECOR-27).
 */
export function createSimulatedPackagesClient(
  storage?: KeyValueStorage | null,
  delayMs = 300,
): PackagesClient {
  let memory: Record<string, SimulatedPackage> = {};

  if (storage === undefined && typeof window !== "undefined") {
    try {
      storage = window.sessionStorage;
    } catch {
      storage = null;
    }
  }

  const load = (): Record<string, SimulatedPackage> => {
    try {
      const raw = storage?.getItem(SIMULATED_STORAGE_KEY);

      return raw ? (JSON.parse(raw) as Record<string, SimulatedPackage>) : memory;
    } catch {
      return memory;
    }
  };

  const save = (packages: Record<string, SimulatedPackage>) => {
    memory = packages;

    try {
      storage?.setItem(SIMULATED_STORAGE_KEY, JSON.stringify(packages));
    } catch {
      // Sin almacenamiento (modo privado): la simulación sigue en memoria.
    }
  };

  const wait = () => new Promise((resolve) => setTimeout(resolve, delayMs));

  return {
    mode: "simulated",
    async createPackage(definition) {
      await wait();

      if (!isSpaceType(definition.spaceType)) {
        return failure("invalid", 422, "package.invalid_space_type", "Elige el tipo de espacio.");
      }

      if (!isValidCapacity(definition.capacityM2)) {
        return failure(
          "invalid",
          422,
          "package.invalid_capacity",
          "La capacidad debe ser un número mayor que 0.",
        );
      }

      const created: CreatedPackage = {
        capacityM2: definition.capacityM2,
        id: newId(),
        spaceType: definition.spaceType,
      };

      save({ ...load(), [created.id]: { ...created, items: [], version: 1 } });

      return ok(created);
    },
    async addItem(packageId, moduleId, quantity = 1) {
      await wait();

      const packages = load();
      const current = packages[packageId];

      if (!current) {
        return failure("not_found", 404, "package.not_found", "No encontramos este paquete.");
      }

      if (moduleId.trim() === "") {
        return failure("invalid", 400, "package.invalid_module", "El módulo no es válido.");
      }

      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_BATCH_QUANTITY) {
        return failure(
          "invalid",
          400,
          "package.invalid_quantity",
          `La cantidad debe ser un entero entre 1 y ${MAX_BATCH_QUANTITY}.`,
        );
      }

      const itemIds = Array.from({ length: quantity }, () => newId());
      const updated: SimulatedPackage = {
        ...current,
        items: [...current.items, ...itemIds.map((itemId) => ({ itemId, moduleId }))],
        version: current.version + quantity,
      };

      save({ ...packages, [packageId]: updated });

      return ok({ itemId: itemIds[0], itemIds, packageVersion: updated.version });
    },
    async clonePackage(packageId) {
      await wait();

      const packages = load();
      const current = packages[packageId];

      if (!current) {
        return failure("not_found", 404, "package.not_found", "No encontramos este paquete.");
      }

      const clonedId = newId();
      const cloned: SimulatedPackage = {
        capacityM2: current.capacityM2,
        id: clonedId,
        items: current.items.map((item) => ({ itemId: newId(), moduleId: item.moduleId })),
        spaceType: current.spaceType,
        version: 1,
      };

      save({ ...packages, [clonedId]: cloned });

      return ok({
        capacityM2: cloned.capacityM2,
        id: cloned.id,
        itemCount: cloned.items.length,
        spaceType: cloned.spaceType,
        version: cloned.version,
      });
    },
    async removeItem(packageId, itemId) {
      await wait();

      const packages = load();
      const current = packages[packageId];

      if (!current) {
        return failure("not_found", 404, "package.not_found", "No encontramos este paquete.");
      }

      if (!current.items.some((item) => item.itemId === itemId)) {
        return failure("not_found", 404, "package.item_not_found", "No encontramos este elemento en el paquete.");
      }

      save({
        ...packages,
        [packageId]: {
          ...current,
          items: current.items.filter((item) => item.itemId !== itemId),
          version: current.version + 1,
        },
      });

      return ok(undefined);
    },
  };
}

// --- Selección -------------------------------------------------------------

export function resolvePackagesMode(value: string | undefined): PackagesClientMode {
  return value === "live" ? "live" : "simulated";
}

let browserClient: PackagesClient | undefined;

function createConfiguredClient(): PackagesClient {
  // Next.js sustituye `process.env.NEXT_PUBLIC_*` en tiempo de compilación; la
  // referencia debe escribirse literal para que funcione en el navegador.
  return resolvePackagesMode(process.env.NEXT_PUBLIC_DECOR_PACKAGES_API) === "live"
    ? createHttpPackagesClient()
    : createSimulatedPackagesClient();
}

export function getPackagesClient(): PackagesClient {
  // En el render del servidor solo se usa `mode`; no se memoriza para no
  // compartir una instancia entre peticiones de distintas personas.
  if (typeof window === "undefined") {
    return createConfiguredClient();
  }

  browserClient ??= createConfiguredClient();

  return browserClient;
}
