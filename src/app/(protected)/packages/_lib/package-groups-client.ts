import { err, ok, type Result } from "@/shared/domain/result";

import {
  networkFailure,
  readApiError,
  unexpectedResponseFailure,
  type ApiFailure,
} from "./api-error";
import { PACKAGES_ENDPOINT, resolvePackagesMode, type PackagesClientMode } from "./packages-client";

/**
 * Puerto de la interfaz hacia los grupos decorativos (Composite, DECOR-25):
 *
 * - `POST /api/packages/{id}/groups {name, parentGroupId?, children?: [{moduleId}]}`
 *   → 201 `{groupId, name, parentGroupId, depth, itemIds, packageVersion}`
 * - `PATCH /api/packages/{id}/groups/{groupId} {name}` → 200 `{groupId, name, structureVersion}` (DECOR-43)
 * - `DELETE /api/packages/{id}/groups/{groupId}` → 204; el contenido sube al padre (DECOR-43)
 * - errores `{error:{code,message}}` con 400/401/404/409/422
 *
 * Es un archivo aparte de `packages-client.ts` para no cambiar el puerto que ya
 * consumen el catálogo y el botón de duplicar.
 */

export type GroupRequest = {
  readonly name: string;
  readonly parentGroupId?: string | null;
  readonly moduleIds: readonly string[];
};

export type CreatedGroup = {
  readonly groupId: string;
  readonly name: string;
  readonly parentGroupId: string | null;
  readonly depth: number;
  readonly itemIds: readonly string[];
  readonly packageVersion: number;
};

export type RenamedGroup = {
  readonly groupId: string;
  readonly name: string;
  readonly structureVersion: number;
};

export interface PackageGroupsClient {
  readonly mode: PackagesClientMode;
  createGroup(packageId: string, request: GroupRequest): Promise<Result<CreatedGroup, ApiFailure>>;
  renameGroup(packageId: string, groupId: string, name: string): Promise<Result<RenamedGroup, ApiFailure>>;
  deleteGroup(packageId: string, groupId: string): Promise<Result<void, ApiFailure>>;
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

function isRenamedGroup(value: unknown): value is RenamedGroup {
  if (typeof value !== "object" || value === null) return false;

  const body = value as Record<string, unknown>;

  return (
    typeof body.groupId === "string" && typeof body.name === "string" && typeof body.structureVersion === "number"
  );
}

const groupUrl = (packageId: string, groupId: string) =>
  `${PACKAGES_ENDPOINT}/${encodeURIComponent(packageId)}/groups/${encodeURIComponent(groupId)}`;

export function createHttpPackageGroupsClient(fetcher: typeof fetch = fetch): PackageGroupsClient {
  return {
    mode: "live",
    async createGroup(packageId, request) {
      let response: Response;

      try {
        response = await fetcher(`${PACKAGES_ENDPOINT}/${encodeURIComponent(packageId)}/groups`, {
          body: JSON.stringify({
            children: request.moduleIds.map((moduleId) => ({ moduleId })),
            name: request.name,
            parentGroupId: request.parentGroupId ?? null,
          }),
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
    async renameGroup(packageId, groupId, name) {
      let response: Response;

      try {
        response = await fetcher(groupUrl(packageId, groupId), {
          body: JSON.stringify({ name }),
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          method: "PATCH",
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

      return isRenamedGroup(body) ? ok(body) : err(unexpectedResponseFailure(response.status));
    },
    async deleteGroup(packageId, groupId) {
      let response: Response;

      try {
        response = await fetcher(groupUrl(packageId, groupId), {
          headers: { Accept: "application/json" },
          method: "DELETE",
        });
      } catch {
        return err(networkFailure());
      }

      if (response.status === 204) {
        return ok(undefined);
      }

      return err(response.ok ? unexpectedResponseFailure(response.status) : await readApiError(response));
    },
  };
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `sim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Los grupos solo existen con la API real (DECOR-43): la simulación no
 * mantiene un árbol en el navegador, así que renombrar o eliminar no se finge.
 */
const LIVE_ONLY: ApiFailure = {
  code: "package.groups_live_only",
  kind: "invalid",
  message: "Las zonas solo están disponibles con la API real.",
};

/** Igual que la simulación de paquetes: responde sin red mientras la API no esté activa. */
export function createSimulatedPackageGroupsClient(delayMs = 300): PackageGroupsClient {
  return {
    mode: "simulated",
    async renameGroup() {
      return err(LIVE_ONLY);
    },
    async deleteGroup() {
      return err(LIVE_ONLY);
    },
    async createGroup(_packageId, request) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      return ok({
        depth: request.parentGroupId ? 2 : 1,
        groupId: newId(),
        itemIds: request.moduleIds.map(() => newId()),
        name: request.name.trim(),
        packageVersion: 1 + request.moduleIds.length,
        parentGroupId: request.parentGroupId ?? null,
      });
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
