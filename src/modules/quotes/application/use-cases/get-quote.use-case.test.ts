import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok } from "../../../../shared/domain/result";
import type { QuoteDto } from "../dtos/quote.dto";
import { GetQuoteUseCase } from "./get-quote.use-case";

const OWNER = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const QUOTE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const QUOTE = { id: QUOTE_ID, number: 3, version: 1 } as unknown as QuoteDto;

const session = (user: typeof OWNER | null = OWNER) => ({ currentUser: vi.fn().mockResolvedValue(user) });

describe("GetQuoteUseCase (DECOR-51)", () => {
  it("devuelve la cotización del dueño leída bajo su sesión", async () => {
    const reader = { getQuote: vi.fn().mockResolvedValue(ok(QUOTE)) };

    const result = await new GetQuoteUseCase(session(), reader).execute(QUOTE_ID);

    expect(result).toEqual(ok(QUOTE));
    expect(reader.getQuote).toHaveBeenCalledWith(QUOTE_ID, OWNER.id);
  });

  it("sin sesión responde auth.unauthenticated sin leer", async () => {
    const reader = { getQuote: vi.fn() };

    const result = await new GetQuoteUseCase(session(null), reader).execute(QUOTE_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("auth.unauthenticated");
    expect(reader.getQuote).not.toHaveBeenCalled();
  });

  it("un id mal formado responde quote.not_found sin consultar", async () => {
    const reader = { getQuote: vi.fn() };

    const result = await new GetQuoteUseCase(session(), reader).execute("no-es-uuid");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("quote.not_found");
    expect(reader.getQuote).not.toHaveBeenCalled();
  });

  it("inexistente o ajena (null) responde quote.not_found", async () => {
    const reader = { getQuote: vi.fn().mockResolvedValue(ok(null)) };

    const result = await new GetQuoteUseCase(session(), reader).execute(QUOTE_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("quote.not_found");
  });

  it("propaga el error del lector", async () => {
    const failure = new DomainError("quote.read_failed", "No pudimos leer.");
    const reader = { getQuote: vi.fn().mockResolvedValue(err(failure)) };

    const result = await new GetQuoteUseCase(session(), reader).execute(QUOTE_ID);

    expect(result).toEqual(err(failure));
  });
});
