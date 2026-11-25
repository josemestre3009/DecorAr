/**
 * Claves de idempotencia por intención (DECOR-55). Mientras el usuario
 * reintenta la misma solicitud (mismo contenido), se reutiliza la clave y el
 * servidor devuelve lo que ya creó; si cambia algún dato, es otra intención y
 * se genera otra clave.
 */
export type IntentKeys = {
  keyFor(requestFingerprint: string): string;
};

export function createIntentKeys(generate: () => string = () => crypto.randomUUID()): IntentKeys {
  let current: { readonly fingerprint: string; readonly key: string } | null = null;

  return {
    keyFor(requestFingerprint) {
      if (!current || current.fingerprint !== requestFingerprint) {
        current = { fingerprint: requestFingerprint, key: generate() };
      }
      return current.key;
    },
  };
}
