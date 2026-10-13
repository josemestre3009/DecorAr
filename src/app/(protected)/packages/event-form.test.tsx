import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/shared/domain/result";

import type { PackagesClient } from "./_lib/packages-client";
import { EventForm } from "./event-form";

const push = vi.fn();
const router = { push };

vi.mock("next/navigation", () => ({ useRouter: () => router }));

function fakeClient(createPackage: PackagesClient["createPackage"]): PackagesClient {
  return {
    addItem: vi.fn(),
    clonePackage: vi.fn(),
    createPackage,
    mode: "simulated",
    moveItem: vi.fn(),
    removeItem: vi.fn(),
    updateMetadata: vi.fn(),
  };
}

const CREATED = {
  capacityM2: null,
  clientName: null,
  eventDate: null,
  eventType: null,
  id: "ev-1",
  name: "Boda de Ana",
  spaceType: null,
  spatial: { availableM2: null, requiredM2: 0, status: "pending" as const },
  venue: null,
};

const submit = () => fireEvent.click(screen.getByRole("button", { name: "Crear evento" }));

describe("EventForm (DECOR-44)", () => {
  beforeEach(() => push.mockReset());

  it("expone el nombre accesible y pide solo el nombre", () => {
    render(<EventForm client={fakeClient(vi.fn())} />);

    expect(screen.getByRole("form", { name: "Crear evento" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre del evento")).toBeInTheDocument();
  });

  it("mantiene los detalles opcionales plegados hasta desplegarlos", () => {
    render(<EventForm client={fakeClient(vi.fn())} />);

    const details = screen.getByText("Agregar detalles (opcional)").closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(screen.getByLabelText("Cliente")).toBeInTheDocument();
  });

  it("rechaza un nombre vacío sin llamar a la API", async () => {
    const createPackage = vi.fn();
    render(<EventForm client={fakeClient(createPackage)} />);

    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("El nombre del evento es obligatorio.");
    expect(screen.getByLabelText("Nombre del evento")).toHaveAttribute("aria-invalid", "true");
    expect(createPackage).not.toHaveBeenCalled();
  });

  it("crea un evento solo con nombre y navega a su configurador", async () => {
    const createPackage = vi.fn<PackagesClient["createPackage"]>().mockResolvedValue(ok(CREATED));
    render(<EventForm client={fakeClient(createPackage)} />);

    fireEvent.change(screen.getByLabelText("Nombre del evento"), { target: { value: "  Boda de Ana  " } });
    submit();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/packages/ev-1"));
    expect(createPackage).toHaveBeenCalledWith({
      capacityM2: null,
      clientName: null,
      eventDate: null,
      eventType: null,
      name: "Boda de Ana",
      spaceType: null,
      venue: null,
    });
  });

  it("envía los metadatos opcionales cuando se completan", async () => {
    const createPackage = vi.fn<PackagesClient["createPackage"]>().mockResolvedValue(ok(CREATED));
    render(<EventForm client={fakeClient(createPackage)} />);

    fireEvent.change(screen.getByLabelText("Nombre del evento"), { target: { value: "Boda" } });
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText("Tipo de espacio"), { target: { value: "salonSocial" } });
    fireEvent.change(screen.getByLabelText("Área disponible (m²)"), { target: { value: "30,5" } });
    submit();

    await waitFor(() =>
      expect(createPackage).toHaveBeenCalledWith(expect.objectContaining({
        capacityM2: 30.5,
        clientName: "Ana",
        name: "Boda",
        spaceType: "salonSocial",
      })),
    );
  });

  it("rechaza un área inválida y conserva lo escrito", async () => {
    const createPackage = vi.fn();
    render(<EventForm client={fakeClient(createPackage)} />);

    fireEvent.change(screen.getByLabelText("Nombre del evento"), { target: { value: "Boda" } });
    fireEvent.change(screen.getByLabelText("Área disponible (m²)"), { target: { value: "-3" } });
    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("La capacidad debe ser mayor que 0.");
    expect(createPackage).not.toHaveBeenCalled();
  });

  it("deshabilita el botón mientras se crea el evento", async () => {
    let resolve: (value: Awaited<ReturnType<PackagesClient["createPackage"]>>) => void = () => {};
    const createPackage = vi.fn(
      () => new Promise<Awaited<ReturnType<PackagesClient["createPackage"]>>>((r) => (resolve = r)),
    );
    render(<EventForm client={fakeClient(createPackage)} />);

    fireEvent.change(screen.getByLabelText("Nombre del evento"), { target: { value: "Boda" } });
    submit();

    expect(await screen.findByRole("button", { name: "Creando tu evento…" })).toBeDisabled();

    resolve(err({ kind: "invalid", message: "Nombre inválido.", status: 422 }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nombre inválido.");
    expect(screen.getByRole("button", { name: "Crear evento" })).toBeEnabled();
  });

  it("permite reintentar si el cliente lanza una excepción", async () => {
    const createPackage = vi.fn<PackagesClient["createPackage"]>().mockRejectedValue(new Error("offline"));
    render(<EventForm client={fakeClient(createPackage)} />);

    fireEvent.change(screen.getByLabelText("Nombre del evento"), { target: { value: "Boda" } });
    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos crear el evento. Inténtalo de nuevo.",
    );
    expect(screen.getByRole("button", { name: "Crear evento" })).toBeEnabled();
  });

  it("vuelve al login si la sesión terminó", async () => {
    const createPackage = vi
      .fn<PackagesClient["createPackage"]>()
      .mockResolvedValue(err({ kind: "unauthorized", message: "Sesión terminada", status: 401 }));
    render(<EventForm client={fakeClient(createPackage)} />);

    fireEvent.change(screen.getByLabelText("Nombre del evento"), { target: { value: "Boda" } });
    submit();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });
});
