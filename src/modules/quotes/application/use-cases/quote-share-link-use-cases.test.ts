import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok } from "../../../../shared/domain/result";
import type { PublicQuoteDto, QuoteDto, QuoteShareLinkDto } from "../dtos/quote.dto";
import { CreateQuoteShareLinkUseCase } from "./create-quote-share-link.use-case";
import { GetQuoteShareLinkUseCase } from "./get-quote-share-link.use-case";
import { GetSharedQuoteUseCase } from "./get-shared-quote.use-case";
import { RevokeQuoteShareLinkUseCase } from "./revoke-quote-share-link.use-case";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const QUOTE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LINK_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_LINK_ID = "22222222-2222-4222-8222-222222222222";

// 2026-11-20 12:00 UTC está dentro de la vigencia del 2026-12-01.
const clock = { now: () => new Date("2026-11-20T12:00:00Z") };
const ids = { generate: () => LINK_ID };

function signerDouble() {
  return {
    hash: vi.fn((token: string) => new TextEncoder().encode(`hash:${token}`)),
    isWellFormed: vi.fn((token: string) => token.length === 43),
    sign: vi.fn((linkId: string) => `token-${linkId}`),
  };
}

function quote(overrides: Partial<QuoteDto> = {}): QuoteDto {
  return { id: QUOTE_ID, status: "sent", validUntil: "2026-12-01", ...overrides } as unknown as QuoteDto;
}

function link(overrides: Partial<QuoteShareLinkDto> = {}): QuoteShareLinkDto {
  return {
    createdAt: "2026-11-20T12:00:00Z",
    expiresAt: "2026-12-02T05:00:00Z",
    id: LINK_ID,
    quoteId: QUOTE_ID,
    revokedAt: null,
    ...overrides,
  };
}

describe("CreateQuoteShareLinkUseCase (DECOR-53)", () => {
  it("rechaza sin sesión", async () => {
    const repository = { create: vi.fn() };
    const result = await new CreateQuoteShareLinkUseCase(repository, signerDouble(), ids, clock).execute({
      ownerId: "",
      quote: quote(),
    });

    expect(!result.ok && result.error.code).toBe("auth.unauthenticated");
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("rechaza una cotización en borrador sin llamar al repositorio", async () => {
    const repository = { create: vi.fn() };
    const result = await new CreateQuoteShareLinkUseCase(repository, signerDouble(), ids, clock).execute({
      ownerId: OWNER,
      quote: quote({ status: "draft" }),
    });

    expect(!result.ok && result.error.code).toBe("quote.share_not_allowed");
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("rechaza una cotización ya vencida sin llamar al repositorio", async () => {
    const repository = { create: vi.fn() };
    const result = await new CreateQuoteShareLinkUseCase(repository, signerDouble(), ids, clock).execute({
      ownerId: OWNER,
      quote: quote({ validUntil: "2026-01-01" }),
    });

    expect(!result.ok && result.error.code).toBe("quote.share_expiry_too_far");
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("crea el enlace con el linkId generado y firma su token", async () => {
    const signer = signerDouble();
    const repository = { create: vi.fn().mockResolvedValue(ok(link())) };

    const result = await new CreateQuoteShareLinkUseCase(repository, signer, ids, clock).execute({
      ownerId: OWNER,
      quote: quote(),
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ linkId: LINK_ID, ownerId: OWNER, quoteId: QUOTE_ID }),
    );
    expect(result).toEqual(ok({ ...link(), token: "token-" + LINK_ID }));
  });

  it("si el repositorio reutiliza un enlace con otro id, firma ese id", async () => {
    const signer = signerDouble();
    const repository = { create: vi.fn().mockResolvedValue(ok(link({ id: OTHER_LINK_ID }))) };

    const result = await new CreateQuoteShareLinkUseCase(repository, signer, ids, clock).execute({
      ownerId: OWNER,
      quote: quote(),
    });

    expect(result).toEqual(ok({ ...link({ id: OTHER_LINK_ID }), token: "token-" + OTHER_LINK_ID }));
  });

  it("propaga el error del repositorio", async () => {
    const repository = { create: vi.fn().mockResolvedValue(err(new DomainError("quote.not_found", "x"))) };

    const result = await new CreateQuoteShareLinkUseCase(repository, signerDouble(), ids, clock).execute({
      ownerId: OWNER,
      quote: quote(),
    });

    expect(!result.ok && result.error.code).toBe("quote.not_found");
  });
});

describe("GetQuoteShareLinkUseCase (DECOR-53)", () => {
  it("rechaza sin sesión", async () => {
    const repository = { getActive: vi.fn() };
    const result = await new GetQuoteShareLinkUseCase(repository, signerDouble()).execute({
      ownerId: "",
      quoteId: QUOTE_ID,
    });

    expect(!result.ok && result.error.code).toBe("auth.unauthenticated");
  });

  it("devuelve null cuando no hay enlace activo", async () => {
    const repository = { getActive: vi.fn().mockResolvedValue(ok(null)) };
    const result = await new GetQuoteShareLinkUseCase(repository, signerDouble()).execute({
      ownerId: OWNER,
      quoteId: QUOTE_ID,
    });

    expect(result).toEqual(ok(null));
  });

  it("recalcula el token del enlace activo", async () => {
    const repository = { getActive: vi.fn().mockResolvedValue(ok(link())) };
    const result = await new GetQuoteShareLinkUseCase(repository, signerDouble()).execute({
      ownerId: OWNER,
      quoteId: QUOTE_ID,
    });

    expect(result).toEqual(ok({ ...link(), token: "token-" + LINK_ID }));
  });
});

describe("RevokeQuoteShareLinkUseCase (DECOR-53)", () => {
  it("rechaza sin sesión", async () => {
    const repository = { revoke: vi.fn() };
    const result = await new RevokeQuoteShareLinkUseCase(repository).execute({
      ownerId: "",
      quoteId: QUOTE_ID,
    });

    expect(!result.ok && result.error.code).toBe("auth.unauthenticated");
    expect(repository.revoke).not.toHaveBeenCalled();
  });

  it("delega en el repositorio", async () => {
    const revoked = link({ revokedAt: "2026-11-20T12:00:00Z" });
    const repository = { revoke: vi.fn().mockResolvedValue(ok(revoked)) };

    const result = await new RevokeQuoteShareLinkUseCase(repository).execute({
      ownerId: OWNER,
      quoteId: QUOTE_ID,
    });

    expect(result).toEqual(ok(revoked));
  });
});

describe("GetSharedQuoteUseCase (DECOR-53)", () => {
  const publicQuote = { number: 1, version: 1 } as unknown as PublicQuoteDto;
  const validToken = "x".repeat(43);

  it("rechaza un token con formato inválido sin consultar la base de datos", async () => {
    const reader = { getSharedQuote: vi.fn() };
    const result = await new GetSharedQuoteUseCase(reader, signerDouble()).execute("corto");

    expect(!result.ok && result.error.code).toBe("quote.share_link_not_found");
    expect(reader.getSharedQuote).not.toHaveBeenCalled();
  });

  it("devuelve la cotización cuando el enlace es válido", async () => {
    const reader = { getSharedQuote: vi.fn().mockResolvedValue(ok(publicQuote)) };
    const result = await new GetSharedQuoteUseCase(reader, signerDouble()).execute(validToken);

    expect(result).toEqual(ok(publicQuote));
  });

  it("devuelve el mismo error si el lector no encuentra nada (vencido, revocado o inexistente)", async () => {
    const reader = { getSharedQuote: vi.fn().mockResolvedValue(ok(null)) };
    const result = await new GetSharedQuoteUseCase(reader, signerDouble()).execute(validToken);

    expect(!result.ok && result.error.code).toBe("quote.share_link_not_found");
  });

  it("propaga un error de persistencia", async () => {
    const reader = { getSharedQuote: vi.fn().mockResolvedValue(err(new DomainError("quote.persistence_error", "x"))) };
    const result = await new GetSharedQuoteUseCase(reader, signerDouble()).execute(validToken);

    expect(!result.ok && result.error.code).toBe("quote.persistence_error");
  });
});
