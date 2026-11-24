/**
 * Firma y huella del token de un enlace público (DECOR-53). `sign` es
 * determinista sobre `linkId`, así que el propietario puede volver a ver el
 * mismo token sin que el servidor lo haya guardado en ningún lado; `hash` es
 * lo único que se persiste.
 */
export interface ShareTokenSigner {
  sign(linkId: string): string;
  hash(token: string): Uint8Array;
  isWellFormed(token: string): boolean;
}
