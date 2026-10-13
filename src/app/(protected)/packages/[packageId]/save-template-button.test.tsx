import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/shared/domain/result";

import type { EventTemplatesClient } from "../_lib/event-templates-client";
import { SaveTemplateButton } from "./save-template-button";

const push = vi.fn();
const router = { push, refresh: vi.fn() };

vi.mock("next/navigation", () => ({ useRouter: () => router }));

function fakeClient(createFromEvent: EventTemplatesClient["createFromEvent"]): EventTemplatesClient {
  return {
    createFromEvent,
    instantiate: vi.fn(),
    list: vi.fn().mockResolvedValue(ok([])),
    mode: "live",
    remove: vi.fn(),
    rename: vi.fn(),
  };
}

describe("SaveTemplateButton (DECOR-44)", () => {
  beforeEach(() => push.mockReset());

  it("despliega un formulario con el nombre propuesto por defecto", () => {
    render(<SaveTemplateButton client={fakeClient(vi.fn())} eventName="Boda de Ana" packageId="pkg-1" />);

    const toggle = screen.getByRole("button", { name: "Guardar como plantilla" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    expect(screen.getByRole("form", { name: "Guardar como plantilla" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre de la plantilla")).toHaveValue("Boda de Ana (plantilla)");
  });

  it("guarda la plantilla y anuncia el resultado", async () => {
    const createFromEvent = vi.fn().mockResolvedValue(ok({ id: "tpl-1", name: "Boda clásica" }));
    render(<SaveTemplateButton client={fakeClient(createFromEvent)} eventName="Boda" packageId="pkg-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Guardar como plantilla" }));
    fireEvent.change(screen.getByLabelText("Nombre de la plantilla"), { target: { value: "Boda clásica" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar plantilla" }));

    await waitFor(() => expect(createFromEvent).toHaveBeenCalledWith("pkg-1", "Boda clásica"));
    expect(await screen.findByText(/Plantilla "Boda clásica" guardada\./)).toBeInTheDocument();
  });

  it("rechaza un nombre inválido sin llamar a la API", async () => {
    const createFromEvent = vi.fn();
    render(<SaveTemplateButton client={fakeClient(createFromEvent)} eventName="Boda" packageId="pkg-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Guardar como plantilla" }));
    fireEvent.change(screen.getByLabelText("Nombre de la plantilla"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar plantilla" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("El nombre de la plantilla es obligatorio.");
    expect(createFromEvent).not.toHaveBeenCalled();
  });

  it("muestra el error del servidor y permite reintentar", async () => {
    const createFromEvent = vi
      .fn()
      .mockResolvedValue(err({ kind: "server", message: "No se pudo guardar.", status: 500 }));
    render(<SaveTemplateButton client={fakeClient(createFromEvent)} eventName="Boda" packageId="pkg-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Guardar como plantilla" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar plantilla" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar.");
    expect(screen.getByRole("button", { name: "Guardar plantilla" })).toBeEnabled();
  });
});
