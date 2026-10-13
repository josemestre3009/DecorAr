import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/shared/domain/result";

import type { EventTemplatesClient } from "./_lib/event-templates-client";
import { TemplateManager } from "./template-manager";

const push = vi.fn();
const router = { push, refresh: vi.fn() };

vi.mock("next/navigation", () => ({ useRouter: () => router }));

const TEMPLATES = [
  { id: "t1", name: "Boda clásica", itemCount: 4 },
  { id: "t2", name: "Cumpleaños", itemCount: 1 },
];

const CREATED = {
  capacityM2: null,
  clientName: null,
  eventDate: null,
  eventType: null,
  id: "ev-9",
  name: "Boda nueva",
  spaceType: null,
  spatial: { availableM2: null, requiredM2: 0, status: "pending" as const },
  venue: null,
};

function fakeClient(overrides: Partial<EventTemplatesClient> = {}): EventTemplatesClient {
  return {
    createFromEvent: vi.fn(),
    instantiate: vi.fn(),
    list: vi.fn().mockResolvedValue(ok(TEMPLATES)),
    mode: "simulated",
    remove: vi.fn(),
    rename: vi.fn(),
    ...overrides,
  };
}

describe("TemplateManager (DECOR-44)", () => {
  beforeEach(() => push.mockReset());

  it("carga y lista las plantillas con sus acciones", async () => {
    render(<TemplateManager client={fakeClient()} />);

    expect(await screen.findByText("Boda clásica")).toBeInTheDocument();
    expect(screen.getByText("Cumpleaños")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Usar plantilla/ })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /Renombrar plantilla/ })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /Eliminar plantilla/ })).toHaveLength(2);
  });

  it("muestra un estado vacío propio", async () => {
    render(<TemplateManager client={fakeClient({ list: vi.fn().mockResolvedValue(ok([])) })} />);

    expect(await screen.findByText("Aún no tienes plantillas.")).toBeInTheDocument();
  });

  it("muestra el error y reintenta la carga", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce(err({ kind: "server", message: "boom" }))
      .mockResolvedValueOnce(ok(TEMPLATES));
    render(<TemplateManager client={fakeClient({ list })} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar tus plantillas.");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Boda clásica")).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("renombra una plantilla en línea y actualiza la tarjeta", async () => {
    const rename = vi.fn().mockResolvedValue(ok({ id: "t1", name: "Boda moderna" }));
    render(<TemplateManager client={fakeClient({ rename })} />);

    fireEvent.click((await screen.findAllByRole("button", { name: /Renombrar plantilla/ }))[0]);
    const input = screen.getByLabelText("Nuevo nombre");
    expect(input).toHaveValue("Boda clásica");
    fireEvent.change(input, { target: { value: "Boda moderna" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar nombre" }));

    await waitFor(() => expect(rename).toHaveBeenCalledWith("t1", "Boda moderna"));
    expect(await screen.findByText("Boda moderna")).toBeInTheDocument();
  });

  it("elimina una plantilla tras confirmar", async () => {
    const remove = vi.fn().mockResolvedValue(ok(undefined));
    render(<TemplateManager client={fakeClient({ remove })} />);

    fireEvent.click((await screen.findAllByRole("button", { name: /Eliminar plantilla/ }))[0]);
    expect(screen.getByText(/¿Eliminar la plantilla "Boda clásica"\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sí, eliminar" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith("t1"));
    await waitFor(() => expect(screen.queryByText("Boda clásica")).not.toBeInTheDocument());
    expect(screen.getByText("Cumpleaños")).toBeInTheDocument();
  });

  it("usa una plantilla pidiendo el nombre del nuevo evento y navega", async () => {
    const instantiate = vi.fn().mockResolvedValue(ok(CREATED));
    render(<TemplateManager client={fakeClient({ instantiate })} />);

    fireEvent.click((await screen.findAllByRole("button", { name: /Usar plantilla/ }))[0]);
    const input = screen.getByLabelText("Nombre del evento");
    expect(input).toHaveValue("Boda clásica (evento)");
    fireEvent.change(input, { target: { value: "Boda nueva" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear evento" }));

    await waitFor(() => expect(instantiate).toHaveBeenCalledWith("t1", "Boda nueva"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/packages/ev-9"));
  });

  it("asocia el error de nombre inválido al campo", async () => {
    render(<TemplateManager client={fakeClient()} />);

    fireEvent.click((await screen.findAllByRole("button", { name: /Renombrar plantilla/ }))[0]);
    fireEvent.change(screen.getByLabelText("Nuevo nombre"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar nombre" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("El nombre de la plantilla es obligatorio.");
    expect(screen.getByLabelText("Nuevo nombre")).toHaveAttribute("aria-describedby", alert.id);
  });
});
