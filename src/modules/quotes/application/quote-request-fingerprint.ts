import type { QuoteTerms } from "../domain/quote";

type FingerprintInput =
  | { readonly operation: "create_quote"; readonly packageId: string; readonly terms: QuoteTerms }
  | {
      readonly operation: "create_quote_version";
      readonly quoteId: string;
      readonly expectedVersion: number;
      readonly terms: QuoteTerms;
    };

/**
 * Forma canónica de lo que pidió el cliente (DECOR-55): operación, destino y
 * términos ya validados, con las claves en orden fijo. Dos reintentos con la
 * misma `Idempotency-Key` deben producir la misma cadena; si no, la clave se
 * está reutilizando para otra solicitud. No incluye la instantánea del
 * evento: un reintento después de editar el evento sigue siendo un reintento
 * mientras el evento siga existiendo con elementos.
 */
export function quoteRequestFingerprint(input: FingerprintInput): string {
  const { terms } = input;
  const canonicalTerms = [
    terms.clientName,
    terms.conditions,
    terms.depositRateBp,
    terms.discountRateBp,
    terms.taxRateBp,
    terms.validUntil,
  ];

  return input.operation === "create_quote"
    ? JSON.stringify([input.operation, input.packageId, canonicalTerms])
    : JSON.stringify([input.operation, input.quoteId, input.expectedVersion, canonicalTerms]);
}
