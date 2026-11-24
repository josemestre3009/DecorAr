import "server-only";

import { createHash, createHmac } from "node:crypto";

import type { ShareTokenSigner } from "../application/ports/share-token-signer.port";

/** Token base64url de 43 caracteres: HMAC-SHA256 (32 bytes) sin relleno. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function toBase64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

/**
 * Firma determinista del enlace público (DECOR-53): `token = HMAC-SHA256(secret, linkId)`.
 * El servidor puede recalcular el mismo token a partir del `linkId` sin
 * haberlo guardado jamás; la base de datos guarda solo `hash(token)`. Rotar
 * `secret` invalida todos los enlaces activos a la vez.
 */
export class HmacShareTokenSigner implements ShareTokenSigner {
  constructor(private readonly secret: string) {}

  sign(linkId: string): string {
    return toBase64Url(createHmac("sha256", this.secret).update(linkId).digest());
  }

  hash(token: string): Uint8Array {
    return createHash("sha256").update(token).digest();
  }

  isWellFormed(token: string): boolean {
    return TOKEN_PATTERN.test(token);
  }
}
