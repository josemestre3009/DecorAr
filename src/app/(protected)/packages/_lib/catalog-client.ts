import type { CatalogModuleDto } from "@/modules/catalog/application/dtos/catalog-module.dto";
import { err, ok, type Result } from "@/shared/domain/result";

import {
  networkFailure,
  readApiError,
  unexpectedResponseFailure,
  type ApiFailure,
} from "./api-error";

export const CATALOG_ENDPOINT = "/api/modules";

/**
 * Comprueba los campos que la tarjeta necesita. Una fila incompleta haría que la
 * tarjeta mostrara "NaN" o "undefined"; se trata como respuesta inesperada.
 */
function isCatalogModule(value: unknown): value is CatalogModuleDto {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const item = value as Record<string, unknown>;

  return (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.priceCop === "number" &&
    typeof item.areaM2 === "number" &&
    (typeof item.posterUrl === "string" || item.posterUrl === null)
  );
}

/**
 * Consulta el catálogo a través del Route Handler de DECOR-28. El navegador
 * nunca lee `catalog_modules` directamente.
 *
 * La API responde con `Cache-Control: public, max-age=60`, incluso con `[]`;
 * `no-store` obliga a que "Reintentar" y "Volver a consultar" pidan de nuevo.
 */
export async function fetchCatalogModules(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Result<CatalogModuleDto[], ApiFailure>> {
  let response: Response;

  try {
    response = await fetcher(CATALOG_ENDPOINT, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }

    return err(networkFailure());
  }

  if (!response.ok) {
    return err(await readApiError(response));
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    return err(unexpectedResponseFailure(response.status));
  }

  if (!Array.isArray(body) || !body.every(isCatalogModule)) {
    return err(unexpectedResponseFailure(response.status));
  }

  return ok(body);
}
