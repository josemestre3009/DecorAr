import { describe, expect, it, vi } from "vitest";

import { HmacShareTokenSigner } from "./hmac-share-token-signer";

vi.mock("server-only", () => ({}));

const SECRET = "test-secret-at-least-32-bytes-long!!";
const LINK_ID = "11111111-1111-4111-8111-111111111111";

describe("HmacShareTokenSigner (DECOR-53)", () => {
  it("firma de forma determinista: mismo linkId, mismo token", () => {
    const signer = new HmacShareTokenSigner(SECRET);

    expect(signer.sign(LINK_ID)).toBe(signer.sign(LINK_ID));
  });

  it("produce un token base64url de 43 caracteres", () => {
    const signer = new HmacShareTokenSigner(SECRET);
    const token = signer.sign(LINK_ID);

    expect(token).toHaveLength(43);
    expect(signer.isWellFormed(token)).toBe(true);
  });

  it("linkId distinto produce token distinto", () => {
    const signer = new HmacShareTokenSigner(SECRET);

    expect(signer.sign(LINK_ID)).not.toBe(signer.sign("22222222-2222-4222-8222-222222222222"));
  });

  it("secretos distintos producen tokens distintos para el mismo linkId", () => {
    const a = new HmacShareTokenSigner(SECRET);
    const b = new HmacShareTokenSigner("other-secret-also-32-bytes-long!!!");

    expect(a.sign(LINK_ID)).not.toBe(b.sign(LINK_ID));
  });

  it("hash es determinista y de 32 bytes (sha256)", () => {
    const signer = new HmacShareTokenSigner(SECRET);
    const token = signer.sign(LINK_ID);

    const hash1 = signer.hash(token);
    const hash2 = signer.hash(token);

    expect(hash1).toHaveLength(32);
    expect(Buffer.from(hash1).equals(Buffer.from(hash2))).toBe(true);
  });

  it("isWellFormed rechaza formatos inválidos", () => {
    const signer = new HmacShareTokenSigner(SECRET);

    expect(signer.isWellFormed("")).toBe(false);
    expect(signer.isWellFormed("demasiado-corto")).toBe(false);
    expect(signer.isWellFormed("x".repeat(43))).toBe(true);
    expect(signer.isWellFormed("x".repeat(44))).toBe(false);
    expect(signer.isWellFormed(`${"x".repeat(42)}+`)).toBe(false);
  });
});
