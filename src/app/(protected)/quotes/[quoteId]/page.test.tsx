import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/shared/domain/domain-error";
import { err, ok } from "@/shared/domain/result";

import { QUOTE_FIXTURE } from "../_lib/test-fixtures";

const { notFoundMock, redirectMock, depsMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirectMock: vi.fn((path: string): never => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  depsMock: { getQuote: { execute: vi.fn() } },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock, redirect: redirectMock }));
vi.mock("@/composition/server", () => ({
  createQuoteQueryDependencies: vi.fn(async () => depsMock),
}));
vi.mock("@/composition/session-guard", () => ({ requireSessionUser: vi.fn() }));

const { loadQuotePreview } = await import("./page");

describe("loadQuotePreview (Server Component de la vista previa, DECOR-51)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("devuelve la versión guardada tal cual", async () => {
    depsMock.getQuote.execute.mockResolvedValue(ok(QUOTE_FIXTURE));

    await expect(loadQuotePreview(QUOTE_FIXTURE.id)).resolves.toEqual({
      latestVersion: QUOTE_FIXTURE.version,
      quote: QUOTE_FIXTURE,
      status: "ready",
    });
    expect(depsMock.getQuote.execute).toHaveBeenCalledWith(QUOTE_FIXTURE.id);
  });

  it("una cotización ajena o inexistente responde 404", async () => {
    depsMock.getQuote.execute.mockResolvedValue(err(new DomainError("quote.not_found", "No encontramos esta cotización.")));

    await expect(loadQuotePreview("ajena")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("sin sesión redirige a /login", async () => {
    depsMock.getQuote.execute.mockResolvedValue(err(new DomainError("auth.unauthenticated", "Inicia sesión.")));

    await expect(loadQuotePreview(QUOTE_FIXTURE.id)).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("un fallo de lectura muestra el estado de error sin detalles internos", async () => {
    depsMock.getQuote.execute.mockResolvedValue(err(new DomainError("quote.read_failed", "detalle interno")));

    await expect(loadQuotePreview(QUOTE_FIXTURE.id)).resolves.toEqual({ status: "error" });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[QuotePage]"), "quote.read_failed");
  });
});
