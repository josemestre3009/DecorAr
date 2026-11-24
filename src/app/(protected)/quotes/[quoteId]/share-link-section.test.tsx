import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/shared/domain/result";

import { ShareLinkSection } from "./share-link-section";

const QUOTE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const LINK = {
  expiresAt: "2026-12-02T05:00:00.000Z",
  id: "link-1",
  revokedAt: null,
  url: "https://decorar.example/c/token-de-ejemplo",
};

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

  it("no se muestra con una cotización en borrador", () => {
    render(<ShareLinkSection client={fakeClient()} quoteId={QUOTE_ID} status="draft" />);

    expect(screen.queryByText("Enlace para el cliente")).not.toBeInTheDocument();
  });

  it("no se muestra con una cotización vencida", () => {
    render(<ShareLinkSection client={fakeClient()} quoteId={QUOTE_ID} status="expired" />);

    expect(screen.queryByText("Enlace para el cliente")).not.toBeInTheDocument();
  });

  it("con una cotización enviada, ofrece crear el enlace si no hay uno activo", async () => {
    const client = fakeClient();
    render(<ShareLinkSection client={client} quoteId={QUOTE_ID} status="sent" />);

    expect(await screen.findByRole("button", { name: "Crear enlace" })).toBeInTheDocument();
    expect(client.getShareLink).toHaveBeenCalledWith(QUOTE_ID);
  });

  it("muestra el enlace activo existente al cargar", async () => {
    const client = fakeClient({ getShareLink: vi.fn().mockResolvedValue(ok(LINK)) });
    render(<ShareLinkSection client={client} quoteId={QUOTE_ID} status="accepted" />);

    expect(await screen.findByDisplayValue(LINK.url)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar enlace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revocar enlace" })).toBeInTheDocument();
  });

  it("crear el enlace muestra la URL devuelta", async () => {
    const client = fakeClient();
    render(<ShareLinkSection client={client} quoteId={QUOTE_ID} status="sent" />);

    fireEvent.click(await screen.findByRole("button", { name: "Crear enlace" }));

    await waitFor(() => expect(screen.getByDisplayValue(LINK.url)).toBeInTheDocument());
    expect(client.createShareLink).toHaveBeenCalledWith(QUOTE_ID);
  });

  it("copiar enlace usa el portapapeles y muestra confirmación", async () => {
    const client = fakeClient({ getShareLink: vi.fn().mockResolvedValue(ok(LINK)) });
    render(<ShareLinkSection client={client} quoteId={QUOTE_ID} status="sent" />);

    await screen.findByDisplayValue(LINK.url);
    fireEvent.click(screen.getByRole("button", { name: "Copiar enlace" }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(LINK.url));
    expect(await screen.findByRole("button", { name: "Copiado" })).toBeInTheDocument();
  });

  it("revocar el enlace vuelve a mostrar el botón de crear", async () => {
    const client = fakeClient({ getShareLink: vi.fn().mockResolvedValue(ok(LINK)) });
    render(<ShareLinkSection client={client} quoteId={QUOTE_ID} status="sent" />);

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
    render(<ShareLinkSection client={client} quoteId={QUOTE_ID} status="sent" />);

    fireEvent.click(await screen.findByRole("button", { name: "Crear enlace" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Solo se puede compartir una cotización enviada o aceptada.",
    );
  });
});
