import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/shared/domain/result";

import { ShareLinkSection } from "./share-link-section";
import { SHARE_ERROR } from "./whatsapp-share-actions";

const QUOTE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const LINK = {
  expiresAt: "2026-12-02T05:00:00.000Z",
  id: "link-1",
  revokedAt: null,
  url: "https://decorar.example/c/token-de-ejemplo",
};

const SUMMARY = { clientName: "Ana Pérez", number: 12, totalCop: 535_500, validUntil: "2026-12-01", version: 2 };

type ShareLinkClient = Pick<
  import("../_lib/quotes-client").QuotesClient,
  "getShareLink" | "createShareLink" | "revokeShareLink"
>;

function fakeClient(overrides: Partial<ShareLinkClient> = {}): ShareLinkClient {
  return {
    createShareLink: vi.fn().mockResolvedValue(ok(LINK)),
    getShareLink: vi.fn().mockResolvedValue(ok(null)),
    revokeShareLink: vi.fn().mockResolvedValue(ok(undefined)),
    ...overrides,
  };
}

describe("ShareLinkSection (DECOR-53)", () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "share");
  });

  it("no se muestra con una cotización en borrador", () => {
    render(<ShareLinkSection client={fakeClient()} quoteId={QUOTE_ID} summary={SUMMARY} status="draft" />);

    expect(screen.queryByText("Enlace para el cliente")).not.toBeInTheDocument();
  });

  it("no se muestra con una cotización vencida", () => {
    render(<ShareLinkSection client={fakeClient()} quoteId={QUOTE_ID} summary={SUMMARY} status="expired" />);

    expect(screen.queryByText("Enlace para el cliente")).not.toBeInTheDocument();
  });

  it("con una cotización enviada, ofrece crear el enlace si no hay uno activo", async () => {
    const client = fakeClient();
    render(<ShareLinkSection client={client} quoteId={QUOTE_ID} summary={SUMMARY} status="sent" />);

    expect(await screen.findByRole("button", { name: "Crear enlace" })).toBeInTheDocument();
    expect(client.getShareLink).toHaveBeenCalledWith(QUOTE_ID);
  });

  it("muestra el enlace activo existente al cargar", async () => {
    const client = fakeClient({ getShareLink: vi.fn().mockResolvedValue(ok(LINK)) });
    render(<ShareLinkSection client={client} quoteId={QUOTE_ID} summary={SUMMARY} status="accepted" />);

    expect(await screen.findByDisplayValue(LINK.url)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar enlace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revocar enlace" })).toBeInTheDocument();
  });

  it("crear el enlace muestra la URL devuelta", async () => {
    const client = fakeClient();
    render(<ShareLinkSection client={client} quoteId={QUOTE_ID} summary={SUMMARY} status="sent" />);

    fireEvent.click(await screen.findByRole("button", { name: "Crear enlace" }));

    await waitFor(() => expect(screen.getByDisplayValue(LINK.url)).toBeInTheDocument());
    expect(client.createShareLink).toHaveBeenCalledWith(QUOTE_ID);
  });

  it("copiar enlace usa el portapapeles y muestra confirmación", async () => {
    const client = fakeClient({ getShareLink: vi.fn().mockResolvedValue(ok(LINK)) });
    render(<ShareLinkSection client={client} quoteId={QUOTE_ID} summary={SUMMARY} status="sent" />);

    await screen.findByDisplayValue(LINK.url);
    fireEvent.click(screen.getByRole("button", { name: "Copiar enlace" }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(LINK.url));
    expect(await screen.findByRole("button", { name: "Copiado" })).toBeInTheDocument();
  });

  it("revocar el enlace vuelve a mostrar el botón de crear", async () => {
    const client = fakeClient({ getShareLink: vi.fn().mockResolvedValue(ok(LINK)) });
    render(<ShareLinkSection client={client} quoteId={QUOTE_ID} summary={SUMMARY} status="sent" />);

    await screen.findByDisplayValue(LINK.url);
    fireEvent.click(screen.getByRole("button", { name: "Revocar enlace" }));

    expect(await screen.findByRole("button", { name: "Crear enlace" })).toBeInTheDocument();
    expect(client.revokeShareLink).toHaveBeenCalledWith(QUOTE_ID);
  });

  it("muestra el error del servidor al no poder compartir", async () => {
    const client = fakeClient({
      createShareLink: vi
        .fn()
        .mockResolvedValue(err({ kind: "invalid", message: "Solo se puede compartir una cotización enviada o aceptada." })),
    });
    render(<ShareLinkSection client={client} quoteId={QUOTE_ID} summary={SUMMARY} status="sent" />);

    fireEvent.click(await screen.findByRole("button", { name: "Crear enlace" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Solo se puede compartir una cotización enviada o aceptada.",
    );
  });

  it("con enlace activo, WhatsApp lleva el mensaje con el enlace público correcto (DECOR-54)", async () => {
    const client = fakeClient({ getShareLink: vi.fn().mockResolvedValue(ok(LINK)) });
    render(<ShareLinkSection client={client} quoteId={QUOTE_ID} summary={SUMMARY} status="sent" />);

    const whatsApp = await screen.findByRole("link", { name: "Enviar por WhatsApp" });
    const text = new URL(whatsApp.getAttribute("href") ?? "").searchParams.get("text") ?? "";

    expect(text).toContain("Ana Pérez");
    expect(text).toContain("Cotización N.º 12 · versión 2");
    expect(text).toContain("535.500");
    expect(text).toContain("Válida hasta");
    expect(text).toContain(LINK.url);
  });

  it("sin enlace activo no ofrece compartir por WhatsApp (DECOR-54)", async () => {
    render(<ShareLinkSection client={fakeClient()} quoteId={QUOTE_ID} summary={SUMMARY} status="sent" />);

    await screen.findByRole("button", { name: "Crear enlace" });
    expect(screen.queryByRole("link", { name: "Enviar por WhatsApp" })).not.toBeInTheDocument();
  });

  it("un fallo al compartir se muestra en la sección y copiar sigue de respaldo (DECOR-54)", async () => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: vi.fn().mockRejectedValue(new DOMException("Blocked", "NotAllowedError")),
      writable: true,
    });
    const client = fakeClient({ getShareLink: vi.fn().mockResolvedValue(ok(LINK)) });
    render(<ShareLinkSection client={client} quoteId={QUOTE_ID} summary={SUMMARY} status="sent" />);

    fireEvent.click(await screen.findByRole("button", { name: "Compartir" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(SHARE_ERROR);

    fireEvent.click(screen.getByRole("button", { name: "Copiar enlace" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(LINK.url));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
