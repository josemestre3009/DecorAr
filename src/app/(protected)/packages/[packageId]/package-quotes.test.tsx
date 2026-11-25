import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/shared/domain/result";

import type { QuoteListItem, QuotesClient } from "../../quotes/_lib/quotes-client";
import { latestQuotesForPackage, PackageQuotes } from "./package-quotes";

const push = vi.fn();
// El router de Next es estable entre renders; el mock también.
const router = { push, refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function quote(overrides: Partial<QuoteListItem>): QuoteListItem {
  return {
    createdAt: "2026-11-24T10:00:00Z",
    id: "q",
    number: 1,
    packageId: "pkg-1",
    status: "draft",
    totalCop: 100000,
    validUntil: "2026-12-01",
    version: 1,
    ...overrides,
  };
}

function client(listQuotes: QuotesClient["listQuotes"]): Pick<QuotesClient, "listQuotes"> {
  return { listQuotes };
}

beforeEach(() => push.mockReset());

describe("latestQuotesForPackage", () => {
  it("deja solo la última versión de cada cotización del evento, la más nueva primero", () => {
    const quotes = [
      quote({ id: "q1-v2", number: 1, version: 2 }),
      quote({ id: "otro", number: 9, packageId: "pkg-2" }),
      quote({ id: "q2-v1", number: 2, version: 1 }),
      quote({ id: "q1-v1", number: 1, version: 1 }),
    ];

    expect(latestQuotesForPackage(quotes, "pkg-1").map((item) => item.id)).toEqual(["q2-v1", "q1-v2"]);
  });
});

describe("PackageQuotes (DECOR-49)", () => {
  it("lista las cotizaciones del evento con su estado, total y siguiente acción", async () => {
    const listQuotes = vi.fn<QuotesClient["listQuotes"]>().mockResolvedValue(
      ok([
        quote({ id: "q-2", number: 2, status: "sent", totalCop: 350000 }),
        quote({ id: "q-1", number: 1, status: "draft" }),
      ]),
    );

    render(<PackageQuotes client={client(listQuotes)} packageId="pkg-1" />);

    const link = await screen.findByRole("link", { name: "Cotización N.º 2 · versión 1" });
    expect(link).toHaveAttribute("href", "/quotes/q-2");
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]!).getByText("Enviada")).toBeInTheDocument();
    expect(within(items[0]!).getByText(/Lista para compartir/)).toBeInTheDocument();
    expect(within(items[1]!).getByText("Borrador")).toBeInTheDocument();
    expect(within(items[1]!).getByText(/márcala como enviada/)).toBeInTheDocument();
  });

  it("sin cotizaciones muestra el estado vacío", async () => {
    render(<PackageQuotes client={client(vi.fn().mockResolvedValue(ok([])))} packageId="pkg-1" />);

    expect(await screen.findByText("Todavía no has creado cotizaciones para este evento.")).toBeInTheDocument();
  });

  it("muestra el error con reintento", async () => {
    const listQuotes = vi
      .fn<QuotesClient["listQuotes"]>()
      .mockResolvedValueOnce(err({ kind: "server", message: "Inténtalo de nuevo." }))
      .mockResolvedValueOnce(ok([quote({ id: "q-1" })]));

    render(<PackageQuotes client={client(listQuotes)} packageId="pkg-1" />);

    expect(await screen.findByText("No pudimos cargar tus cotizaciones. Inténtalo de nuevo.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("link", { name: "Cotización N.º 1 · versión 1" })).toBeInTheDocument();
  });

  it("manda a iniciar sesión si la sesión terminó", async () => {
    render(
      <PackageQuotes
        client={client(vi.fn().mockResolvedValue(err({ kind: "unauthorized", message: "x" })))}
        packageId="pkg-1"
      />,
    );

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });
});
