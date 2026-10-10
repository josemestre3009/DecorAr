import type { DomainError } from "../../../../shared/domain/domain-error";
import type { Result } from "../../../../shared/domain/result";
import type { PackageChangeEvent } from "../../../events/application/outbox";

/**
 * Recalcula el presupuesto a partir del mismo evento ya persistido en la
 * outbox. Se invoca justo después de `PackageChangeOutbox.commit`, de modo que
 * el cálculo no depende de que Realtime haya entregado nada (DECOR-33).
 *
 * Es un puerto de `packages` para no acoplar este módulo a `budget`; el
 * adaptador que lo implementa vive en la composición.
 */
export interface PackageChangeConsumer {
  consume(event: PackageChangeEvent): Promise<Result<void, DomainError>>;
}

/**
 * Notifica al consumidor de presupuesto sin afectar la respuesta: el cambio de
 * paquete ya quedó confirmado, así que un fallo de recálculo sólo se registra.
 */
export async function notifyPackageChange(
  consumer: PackageChangeConsumer | undefined,
  event: PackageChangeEvent,
): Promise<void> {
  if (!consumer) {
    return;
  }

  try {
    const result = await consumer.consume(event);

    if (!result.ok) {
      console.error(
        `[packages] recálculo de presupuesto falló (${result.error.code}):`,
        result.error.message,
      );
    }
  } catch (cause) {
    console.error("[packages] recálculo de presupuesto lanzó una excepción:", cause);
  }
}
