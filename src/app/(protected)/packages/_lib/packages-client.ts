import { err, ok, type Result } from "@/shared/domain/result";
import type {
  EventMetadataDto,
  PackageMetadataPatch,
  SpatialDiagnosticDto,
} from "@/modules/packages/application/dtos/package.dto";
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
  validateEventName,
  type SpaceType,
} from "./space-definition";

/**
 * Puerto de la interfaz hacia la API de eventos (persistidos como `package`,
 * nombre técnico interno). Contrato DECOR-44:
 *
 * - `POST /api/packages {name, ...metadata?}` → 201 `CreatedPackage`
 * - `PATCH /api/packages/{id} {name?, clientName?, ...}` → 200 `CreatedPackage`
 * - `POST /api/packages/{id}/items {moduleId}` → 201 `{itemId, packageVersion}`
 * - errores `{error:{code,message}}` con 400/401/404/409/422
 *
 * Mientras la API no esté activa se usa la implementación simulada; cuando
 * exista, basta con `NEXT_PUBLIC_DECOR_PACKAGES_API=live`.
 */

/** Metadatos editables de un evento; solo `name` es obligatorio. */
export type CreatePackageInput = {
  readonly name: string;
  readonly clientName?: string | null;
  readonly eventDate?: string | null;
  readonly venue?: string | null;
  readonly eventType?: string | null;
  readonly spaceType?: SpaceType | null;
  readonly capacityM2?: number | null;
};

export type CreatedPackage = EventMetadataDto & {
  readonly id: string;
  readonly spatial: SpatialDiagnosticDto;
};

export type AddedItem = {
  readonly itemId: string;
  readonly itemIds?: readonly string[];
  readonly packageVersion: number;
};

export type MoveItemRequest = {
  /** `null` mueve el módulo a la raíz. */
  readonly groupId: string | null;
  readonly expectedVersion?: number;
};

export type MovedItem = {
  readonly itemId: string;
  readonly packageVersion: number;
};

export type ClonedPackage = {
  readonly id: string;
  readonly spaceType: SpaceType | null;
  readonly capacityM2: number | null;
  readonly style?: string | null;
  readonly colors?: readonly string[];
  readonly notes?: string;
  readonly version?: number;
  readonly itemCount?: number;
};

export type PackagesClientMode = "live" | "simulated";

export interface PackagesClient {
  readonly mode: PackagesClientMode;
  createPackage(input: CreatePackageInput): Promise<Result<CreatedPackage, ApiFailure>>;
  /** `PATCH /api/packages/{id}`: solo los campos presentes del parche cambian. */
  updateMetadata(packageId: string, patch: PackageMetadataPatch): Promise<Result<CreatedPackage, ApiFailure>>;
  addItem(
    packageId: string,
    moduleId: string,
    quantity?: number,
    groupId?: string | null,
  ): Promise<Result<AddedItem, ApiFailure>>;
  clonePackage(packageId: string): Promise<Result<ClonedPackage, ApiFailure>>;
  /** `DELETE /api/packages/{id}/items/{itemId}` → 204 sin cuerpo. */
  removeItem(packageId: string, itemId: string): Promise<Result<void, ApiFailure>>;
  /** `PATCH /api/packages/{id}/items/{itemId}`: mueve la instancia sin recrearla. */
  moveItem(packageId: string, itemId: string, request: MoveItemRequest): Promise<Result<MovedItem, ApiFailure>>;
}

export const PACKAGES_ENDPOINT = "/api/packages";

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isSpatialDiagnostic(value: unknown): value is SpatialDiagnosticDto {
  if (typeof value !== "object" || value === null) return false;

  const body = value as Record<string, unknown>;

  return (
    (body.status === "pending" || body.status === "compatible" || body.status === "exceeded") &&
    (body.availableM2 === null || typeof body.availableM2 === "number") &&
    typeof body.requiredM2 === "number"
  );
}

export function isCreatedPackage(value: unknown): value is CreatedPackage {
  if (typeof value !== "object" || value === null) return false;

  const body = value as Record<string, unknown>;

  return (
    typeof body.id === "string" &&
    typeof body.name === "string" &&
    isNullableText(body.clientName) &&
    isNullableText(body.eventDate) &&
    isNullableText(body.venue) &&
    isNullableText(body.eventType) &&
    (body.spaceType === null || isSpaceType(body.spaceType)) &&
    (body.capacityM2 === null || isValidCapacity(body.capacityM2)) &&
    isSpatialDiagnostic(body.spatial)
  );
}

function isAddedItem(value: unknown): value is AddedItem {
  if (typeof value !== "object" || value === null) return false;

  const body = value as Record<string, unknown>;

  return typeof body.itemId === "string" &&
    (body.itemIds === undefined || (Array.isArray(body.itemIds) && body.itemIds.every((id) => typeof id === "string"))) &&
    typeof body.packageVersion === "number";
}

function isMovedItem(value: unknown): value is MovedItem {
  if (typeof value !== "object" || value === null) return false;

  const body = value as Record<string, unknown>;

  return typeof body.itemId === "string" && typeof body.packageVersion === "number";
}

function isClonedPackage(value: unknown): value is ClonedPackage {
  if (typeof value !== "object" || value === null) return false;

  const body = value as Record<string, unknown>;

  return (
    typeof body.id === "string" &&
    (body.spaceType === null || isSpaceType(body.spaceType)) &&
    (body.capacityM2 === null || isValidCapacity(body.capacityM2))
  );
}

async function postJson<T>(
  fetcher: typeof fetch,
  url: string,
  payload: unknown,
  isExpected: (value: unknown) => value is T,
  method: "POST" | "PATCH" = "POST",
): Promise<Result<T, ApiFailure>> {
  let response: Response;

  try {
    response = await fetcher(url, {
      body: JSON.stringify(payload),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      method,
    });
  } catch {
    return err(networkFailure());
  }

  if (response.status !== 200 && response.status !== 201) {
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

function metadataPayload(input: CreatePackageInput | PackageMetadataPatch): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  for (const key of ["name", "clientName", "eventDate", "venue", "eventType", "spaceType", "capacityM2"] as const) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) {
      body[key] = value;
    }
  }

  return body;
}

export function createHttpPackagesClient(fetcher: typeof fetch = fetch): PackagesClient {
  return {
    mode: "live",
    createPackage: (input) =>
      postJson(fetcher, PACKAGES_ENDPOINT, metadataPayload(input), isCreatedPackage),
    updateMetadata: (packageId, patch) =>
      postJson(
        fetcher,
        `${PACKAGES_ENDPOINT}/${encodeURIComponent(packageId)}`,
        metadataPayload(patch),
        isCreatedPackage,
        "PATCH",
      ),
    addItem: (packageId, moduleId, quantity = 1, groupId = null) =>
      postJson(
        fetcher,
        `${PACKAGES_ENDPOINT}/${encodeURIComponent(packageId)}/items`,
        groupId !== null
          ? { moduleId, parentGroupId: groupId }
          : quantity === 1
            ? { moduleId }
            : { moduleId, quantity },
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
    moveItem: (packageId, itemId, request) =>
      postJson(
        fetcher,
        `${PACKAGES_ENDPOINT}/${encodeURIComponent(packageId)}/items/${encodeURIComponent(itemId)}`,
        request.expectedVersion === undefined
          ? { groupId: request.groupId }
          : { expectedVersion: request.expectedVersion, groupId: request.groupId },
        isMovedItem,
        "PATCH",
      ),
  };
}

// --- Simulación temporal (hasta que la API esté activa) -------------------

export const SIMULATED_STORAGE_KEY = "decorar.simulated-packages";

type SimulatedPackage = CreatedPackage & {
  version: number;
  items: { itemId: string; moduleId: string; groupId: string | null }[];
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

function simulatedSpatial(capacityM2: number | null, requiredM2 = 0): SpatialDiagnosticDto {
  if (capacityM2 === null) {
    return { availableM2: null, requiredM2, status: "pending" };
  }

  return {
    availableM2: capacityM2,
    requiredM2,
    status: requiredM2 > capacityM2 ? "exceeded" : "compatible",
  };
}

/**
 * Responde como lo hará la API real, sin red ni servidor. Los eventos viven en
 * `sessionStorage`: sobreviven a una recarga, pero no a cerrar la pestaña.
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

  const validate = (input: CreatePackageInput): ApiFailure | null => {
    const name = validateEventName(input.name);
    if (!name.ok) {
      return { code: "package.invalid_name", kind: "invalid", message: name.error, status: 422 };
    }

    if (input.spaceType !== undefined && input.spaceType !== null && !isSpaceType(input.spaceType)) {
      return { code: "package.invalid_space_type", kind: "invalid", message: "Elige el tipo de espacio.", status: 422 };
    }

    if (input.capacityM2 !== undefined && input.capacityM2 !== null && !isValidCapacity(input.capacityM2)) {
      return {
        code: "package.invalid_capacity",
        kind: "invalid",
        message: "La capacidad debe ser un número mayor que 0.",
        status: 422,
      };
    }

    return null;
  };

  return {
    mode: "simulated",
    async createPackage(input) {
      await wait();

      const invalid = validate(input);
      if (invalid) {
        return err(invalid);
      }

      const created: SimulatedPackage = {
        capacityM2: input.capacityM2 ?? null,
        clientName: input.clientName ?? null,
        eventDate: input.eventDate ?? null,
        eventType: input.eventType ?? null,
        id: newId(),
        items: [],
        name: input.name.trim(),
        spaceType: input.spaceType ?? null,
        spatial: simulatedSpatial(input.capacityM2 ?? null),
        venue: input.venue ?? null,
        version: 1,
      };

      save({ ...load(), [created.id]: created });

      return ok(toCreatedPackage(created));
    },
    async updateMetadata(packageId, patch) {
      await wait();

      const packages = load();
      const current = packages[packageId];

      if (!current) {
        return failure("not_found", 404, "package.not_found", "No encontramos este evento.");
      }

      let name = current.name;
      if (patch.name !== undefined) {
        const valid = validateEventName(patch.name);
        if (!valid.ok) {
          return failure("invalid", 422, "package.invalid_name", valid.error);
        }
        name = valid.value;
      }

      const capacityM2 = patch.capacityM2 !== undefined ? patch.capacityM2 : current.capacityM2;
      const updated: SimulatedPackage = {
        ...current,
        capacityM2: capacityM2 ?? null,
        clientName: patch.clientName !== undefined ? patch.clientName : current.clientName,
        eventDate: patch.eventDate !== undefined ? patch.eventDate : current.eventDate,
        eventType: patch.eventType !== undefined ? patch.eventType : current.eventType,
        name,
        spaceType: patch.spaceType !== undefined ? patch.spaceType : current.spaceType,
        spatial: simulatedSpatial(capacityM2 ?? null, current.spatial.requiredM2),
        venue: patch.venue !== undefined ? patch.venue : current.venue,
      };

      save({ ...packages, [packageId]: updated });

      return ok(toCreatedPackage(updated));
    },
    async addItem(packageId, moduleId, quantity = 1, groupId = null) {
      await wait();

      const packages = load();
      const current = packages[packageId];

      if (!current) {
        return failure("not_found", 404, "package.not_found", "No encontramos este evento.");
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
        items: [...current.items, ...itemIds.map((itemId) => ({ groupId, itemId, moduleId }))],
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
        return failure("not_found", 404, "package.not_found", "No encontramos este evento.");
      }

      const clonedId = newId();
      const cloned: SimulatedPackage = {
        ...current,
        id: clonedId,
        items: current.items.map((item) => ({ groupId: item.groupId, itemId: newId(), moduleId: item.moduleId })),
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
        return failure("not_found", 404, "package.not_found", "No encontramos este evento.");
      }

      if (!current.items.some((item) => item.itemId === itemId)) {
        return failure("not_found", 404, "package.item_not_found", "No encontramos este elemento en el evento.");
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
    async moveItem(packageId, itemId, request) {
      await wait();

      const packages = load();
      const current = packages[packageId];

      if (!current) {
        return failure("not_found", 404, "package.not_found", "No encontramos este evento.");
      }

      if (!current.items.some((item) => item.itemId === itemId)) {
        return failure("not_found", 404, "package.item_not_found", "No encontramos este elemento en el evento.");
      }

      if (request.expectedVersion !== undefined && request.expectedVersion !== current.version) {
        return failure("invalid", 409, "package.version_conflict", "El evento cambió. Vuelve a intentarlo.");
      }

      save({
        ...packages,
        [packageId]: {
          ...current,
          items: current.items.map((item) => (item.itemId === itemId ? { ...item, groupId: request.groupId } : item)),
          version: current.version + 1,
        },
      });

      return ok({ itemId, packageVersion: current.version + 1 });
    },
  };
}

function toCreatedPackage(pkg: SimulatedPackage): CreatedPackage {
  return {
    capacityM2: pkg.capacityM2,
    clientName: pkg.clientName,
    eventDate: pkg.eventDate,
    eventType: pkg.eventType,
    id: pkg.id,
    name: pkg.name,
    spaceType: pkg.spaceType,
    spatial: pkg.spatial,
    venue: pkg.venue,
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
