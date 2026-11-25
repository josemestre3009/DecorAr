import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Clave de idempotencia de una creación de cotización o de versión
 * (DECOR-55). El cliente genera un UUID por intención del usuario y lo
 * reutiliza en cada reintento; el servidor devuelve lo ya creado en vez de
 * asignar otro número o versión.
 */
export function parseIdempotencyKey(value: unknown): Result<string, DomainError> {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";

  if (!UUID.test(normalized)) {
    return err(
      new DomainError(
        "idempotency.key_invalid",
        "La cabecera Idempotency-Key es obligatoria y debe ser un UUID.",
      ),
    );
  }

  return ok(normalized);
}
