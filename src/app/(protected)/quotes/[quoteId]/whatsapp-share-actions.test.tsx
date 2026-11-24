import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SHARE_ERROR, WhatsAppShareActions } from "./whatsapp-share-actions";

const MESSAGE = "Hola, Ana Pérez. Te comparto la Cotización N.º 12 · versión 2.\nPuedes verla aquí: https://decorar.example/c/tok";

function stubShare(share: ((data: ShareData) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "share", { configurable: true, value: share, writable: true });
}

describe("WhatsAppShareActions (DECOR-54)", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "share");
  });

  it("siempre ofrece WhatsApp por wa.me con el mensaje codificado, en otra pestaña", () => {
    stubShare(undefined);
    render(<WhatsAppShareActions message={MESSAGE} onError={vi.fn()} />);

    const link = screen.getByRole("link", { name: "Enviar por WhatsApp" });
    const href = link.getAttribute("href") ?? "";

    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    expect(new URL(href).searchParams.get("text")).toBe(MESSAGE);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("sin Web Share API no muestra el botón Compartir", () => {
    stubShare(undefined);
    render(<WhatsAppShareActions message={MESSAGE} onError={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Compartir" })).not.toBeInTheDocument();
  });

  it("con Web Share API comparte solo el texto, sin adjuntar archivos", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubShare(share);
    const onError = vi.fn();
    render(<WhatsAppShareActions message={MESSAGE} onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: "Compartir" }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share).toHaveBeenCalledWith({ text: MESSAGE });
    expect(share.mock.calls[0][0]).not.toHaveProperty("files");
    expect(onError).not.toHaveBeenCalledWith(SHARE_ERROR);
  });

  it("cancelar el menú de compartir no muestra error", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("Share canceled", "AbortError"));
    stubShare(share);
    const onError = vi.fn();
    render(<WhatsAppShareActions message={MESSAGE} onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: "Compartir" }));

    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(onError).not.toHaveBeenCalledWith(SHARE_ERROR);
  });

  it("un fallo al compartir avisa y sugiere WhatsApp o copiar el enlace", async () => {
    stubShare(vi.fn().mockRejectedValue(new DOMException("Blocked", "NotAllowedError")));
    const onError = vi.fn();
    render(<WhatsAppShareActions message={MESSAGE} onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: "Compartir" }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith(SHARE_ERROR));
  });

  it("deshabilitado no comparte ni abre WhatsApp", () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubShare(share);
    render(<WhatsAppShareActions disabled message={MESSAGE} onError={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Compartir" })).toBeDisabled();
    const link = screen.getByRole("link", { name: "Enviar por WhatsApp" });
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(fireEvent.click(link)).toBe(false);
    expect(share).not.toHaveBeenCalled();
  });
});
