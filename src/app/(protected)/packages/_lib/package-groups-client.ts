import { err, ok, type Result } from "@/shared/domain/result";

import {
  networkFailure,
  readApiError,
  unexpectedResponseFailure,
  type ApiFailure,
} from "./api-error";
import { PACKAGES_ENDPOINT, resolvePackagesMode, type PackagesClientMode } from "./packages-client";
import { zoneNameError } from "./zone-tree";

/**
 * Puerto de la interfaz hacia las zonas decorativas (Composite editable):
 *
 * - `POST /api/packages/{id}/groups {name, parentGroupId, children, expectedVersion}`
 *   → 201 `{groupId, name, parentGroupId, depth, itemIds, packageVersion}`
 * - `PATCH /api/packages/{id}/groups/{groupId} {name?, parentGroupId?, expectedVersion}`
 *   → 200 `{packageVersion}`
 * - `DELETE /api/packages/{id}/groups/{groupId} {strategy, expectedVersion}`
 *   → 200 `{packageVersion}`
 * - errores `{error:{code,message}}` con 400/401/404/409/422
 *
 * Es un archivo aparte de `packages-client.ts` para no cambiar el puerto que ya
 * consumen el catálogo y el botón de duplicar.
 */

export type GroupRequest = {
  readonly name: string;
  readonly parentGroupId?: string | null;
  /** Hojas iniciales; la creación inline de zonas va vacía. */
  readonly moduleIds?: readonly string[];
  readonly expectedVersion?: number;
};

export type CreatedGroup = {
  readonly groupId: string;
  readonly name: string;
  readonly parentGroupId: string | null;
  readonly depth: number;
  readonly itemIds: readonly string[];
  readonly packageVersion: number;
};

export type UpdateGroupRequest = {
  readonly name?: string;
  /** `null` mueve la zona a la raíz. */
  readonly parentGroupId?: string | null;
  readonly expectedVersion?: number;
};

export type DeleteGroupStrategy = "move_to_root" | "delete_contents";

export type DeleteGroupRequest = {
  readonly strategy: DeleteGroupStrategy;
  readonly expectedVersion?: number;
};

export type GroupMutation = {
  readonly packageVersion: number;
};

export interface PackageGroupsClient {
  readonly mode: PackagesClientMode;
  createGroup(packageId: string, request: GroupRequest): Promise<Result<CreatedGroup, ApiFailure>>;
  updateGroup(packageId: string, groupId: string, request: UpdateGroupRequest): Promise<Result<GroupMutation, ApiFailure>>;
  deleteGroup(packageId: string, groupId: string, request: DeleteGroupRequest): Promise<Result<GroupMutation, ApiFailure>>;
}

function isCreatedGroup(value: unknown): value is CreatedGroup {
  if (typeof value !== "object" || value === null) return false;

  const body = value as Record<string, unknown>;

  return (
    typeof body.groupId === "string" &&
    typeof body.name === "string" &&
    typeof body.depth === "number" &&
    typeof body.packageVersion === "number" &&
    Array.isArray(body.itemIds) &&
    body.itemIds.every((itemId) => typeof itemId === "string")
  );
}

function isGroupMutation(value: unknown): value is GroupMutation {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).packageVersion === "number"
  );
}

function groupUrl(packageId: string, groupId?: string): string {
  const base = `${PACKAGES_ENDPOINT}/${encodeURIComponent(packageId)}/groups`;

  return groupId === undefined ? base : `${base}/${encodeURIComponent(groupId)}`;
}

async function mutateGroup(
  fetcher: typeof fetch,
  url: string,
  method: "PATCH" | "DELETE",
  payload: unknown,
): Promise<Result<GroupMutation, ApiFailure>> {
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

  if (response.status !== 200) {
    return err(response.ok ? unexpectedResponseFailure(response.status) : await readApiError(response));
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    return err(unexpectedResponseFailure(response.status));
  }

  return isGroupMutation(body) ? ok(body) : err(unexpectedResponseFailure(response.status));
}

export function createHttpPackageGroupsClient(fetcher: typeof fetch = fetch): PackageGroupsClient {
  return {
    mode: "live",
    async createGroup(packageId, request) {
      const payload: Record<string, unknown> = {
        children: (request.moduleIds ?? []).map((moduleId) => ({ moduleId })),
        name: request.name,
        parentGroupId: request.parentGroupId ?? null,
      };

      if (request.expectedVersion !== undefined) {
        payload.expectedVersion = request.expectedVersion;
      }

      let response: Response;

      try {
        response = await fetcher(groupUrl(packageId), {
          body: JSON.stringify(payload),
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          method: "POST",
        });
      } catch {
        return err(networkFailure());
      }

      if (response.status !== 201) {
        return err(response.ok ? unexpectedResponseFailure(response.status) : await readApiError(response));
      }

      let body: unknown;

      try {
        body = await response.json();
      } catch {
        return err(unexpectedResponseFailure(response.status));
      }

      return isCreatedGroup(body) ? ok(body) : err(unexpectedResponseFailure(response.status));
    },
    updateGroup(packageId, groupId, request) {
      const payload: Record<string, unknown> = {};

      if (request.name !== undefined) payload.name = request.name;
      if (request.parentGroupId !== undefined) payload.parentGroupId = request.parentGroupId;
      if (request.expectedVersion !== undefined) payload.expectedVersion = request.expectedVersion;

      return mutateGroup(fetcher, groupUrl(packageId, groupId), "PATCH", payload);
    },
    deleteGroup(packageId, groupId, request) {
      const payload: Record<string, unknown> = { strategy: request.strategy };

      if (request.expectedVersion !== undefined) payload.expectedVersion = request.expectedVersion;

      return mutateGroup(fetcher, groupUrl(packageId, groupId), "DELETE", payload);
    },
  };
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `sim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function failure(kind: ApiFailure["kind"], status: number, code: string, message: string): Result<never, ApiFailure> {
  return err<ApiFailure>({ code, kind, message, status });
}

type SimulatedZone = {
  name: string;
  parentGroupId: string | null;
  depth: number;
};

/** Igual que la simulación de paquetes: responde sin red mientras la API no esté activa. */
export function createSimulatedPackageGroupsClient(delayMs = 300): PackageGroupsClient {
  const zones = new Map<string, SimulatedZone>();

  const wait = () => new Promise((resolve) => setTimeout(resolve, delayMs));

  return {
    mode: "simulated",
    async createGroup(_packageId, request) {
      await wait();

      const invalidName = zoneNameError(request.name);
      if (invalidName) {
        return failure("invalid", 422, "package.invalid_group_name", invalidName);
      }

      const depth = request.parentGroupId ? (zones.get(request.parentGroupId)?.depth ?? 1) + 1 : 1;
      const groupId = newId();
      zones.set(groupId, { depth, name: request.name.trim(), parentGroupId: request.parentGroupId ?? null });

      return ok({
        depth,
        groupId,
        itemIds: (request.moduleIds ?? []).map(() => newId()),
        name: request.name.trim(),
        packageVersion: 1 + (request.moduleIds ?? []).length,
        parentGroupId: request.parentGroupId ?? null,
      });
    },
    async updateGroup(_packageId, groupId, request) {
      await wait();

      const zone = zones.get(groupId);
      if (!zone) {
        return failure("not_found", 404, "package.group_not_found", "No encontramos esta zona.");
      }

      if (request.name !== undefined) {
        const invalidName = zoneNameError(request.name);
        if (invalidName) {
          return failure("invalid", 422, "package.invalid_group_name", invalidName);
        }
        zone.name = request.name.trim();
      }

      if (request.parentGroupId !== undefined) {
        zone.parentGroupId = request.parentGroupId;
      }

      return ok({ packageVersion: (request.expectedVersion ?? 0) + 1 });
    },
    async deleteGroup(_packageId, groupId, request) {
      await wait();

      if (zones.size > 0 && !zones.has(groupId)) {
        return failure("not_found", 404, "package.group_not_found", "No encontramos esta zona.");
      }

      zones.delete(groupId);

      return ok({ packageVersion: (request.expectedVersion ?? 0) + 1 });
    },
  };
}

let browserClient: PackageGroupsClient | undefined;

function createConfiguredClient(): PackageGroupsClient {
  // Next.js sustituye `process.env.NEXT_PUBLIC_*` en tiempo de compilación; la
  // referencia debe escribirse literal para que funcione en el navegador.
  return resolvePackagesMode(process.env.NEXT_PUBLIC_DECOR_PACKAGES_API) === "live"
    ? createHttpPackageGroupsClient()
    : createSimulatedPackageGroupsClient();
}

export function getPackageGroupsClient(): PackageGroupsClient {
  if (typeof window === "undefined") {
    return createConfiguredClient();
  }

  browserClient ??= createConfiguredClient();

  return browserClient;
}
