import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/shared/domain/result";

import type { PackagesClient } from "../_lib/packages-client";
import { EventMetadataEditor } from "./event-metadata-editor";

const push = vi.fn();
const refresh = vi.fn();
const router = { push, refresh };

vi.mock("next/navigation", () => ({ useRouter: () => router }));

const DETAIL = {
  capacityM2: 30 as number | null,
  clientName: "Ana" as string | null,
  eventDate: "2026-12-24" as string | null,
  eventType: "Boda" as string | null,
  name: "Boda de Ana",
  spaceType: "salonSocial" as const,
  venue: "Salón" as string | null,
};

const UPDATED = {
  capacityM2: 30,
  clientName: "Ana",
  eventDate: "2026-12-24",
  eventType: "Boda",
  id: "pkg-1",
  name: "Boda de Ana",
  spaceType: "salonSocial" as const,
  spatial: { availableM2: 30, requiredM2: 0, status: "compatible" as const },
  venue: "Salón",
};

function fakeClient(updateMetadata: PackagesClient["updateMetadata"]): PackagesClient {
  return {
    addItem: vi.fn(),
    clonePackage: vi.fn(),
    createPackage: vi.fn(),
    mode: "live",
    moveItem: vi.fn(),
    removeItem: vi.fn(),
    updateMetadata,
  };
}

describe("EventMetadataEditor (DECOR-44)", () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
  });

  it("mantiene el formulario plegado hasta abrirlo", () => {
    render(<EventMetadataEditor client={fakeClient(vi.fn())} detail={DETAIL} packageId="pkg-1" />);

    const toggle = screen.getByRole("button", { name: "Editar datos" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("form", { name: "Editar datos del evento" })).not.toBeInTheDocument();
  });

  it("abre el formulario en línea, enfoca el nombre y precarga los datos", () => {
    render(<EventMetadataEditor client={fakeClient(vi.fn())} detail={DETAIL} packageId="pkg-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Editar datos" }));

    expect(screen.getByRole("form", { name: "Editar datos del evento" })).toBeInTheDocument();
    const name = screen.getByLabelText("Nombre");
    expect(name).toHaveValue("Boda de Ana");
    expect(name).toHaveFocus();
    expect(screen.getByLabelText("Cliente")).toHaveValue("Ana");
    expect(screen.getByLabelText("Tipo de espacio")).toHaveValue("salonSocial");
  });

  it("guarda los metadatos y anuncia el resultado", async () => {
    const updateMetadata = vi.fn<PackagesClient["updateMetadata"]>().mockResolvedValue(ok(UPDATED));
    render(<EventMetadataEditor client={fakeClient(updateMetadata)} detail={DETAIL} packageId="pkg-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Editar datos" }));
    fireEvent.change(screen.getByLabelText("Lugar"), { target: { value: "Jardín" } });
    fireEvent.change(screen.getByLabelText("Área disponible (m²)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar datos" }));

    await waitFor(() => expect(updateMetadata).toHaveBeenCalledWith("pkg-1", expect.objectContaining({
      capacityM2: null,
      name: "Boda de Ana",
      venue: "Jardín",
    })));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Datos del evento actualizados.");
  });

  it("asocia el error de nombre vacío al campo sin llamar a la API", async () => {
    const updateMetadata = vi.fn();
    render(<EventMetadataEditor client={fakeClient(updateMetadata)} detail={DETAIL} packageId="pkg-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Editar datos" }));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar datos" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("El nombre del evento es obligatorio.");
    expect(screen.getByLabelText("Nombre")).toHaveAttribute("aria-invalid", "true");
    expect(updateMetadata).not.toHaveBeenCalled();
  });

  it("vuelve al login si la sesión terminó", async () => {
    const updateMetadata = vi
      .fn<PackagesClient["updateMetadata"]>()
      .mockResolvedValue(err({ kind: "unauthorized", message: "x", status: 401 }));
    render(<EventMetadataEditor client={fakeClient(updateMetadata)} detail={DETAIL} packageId="pkg-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Editar datos" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar datos" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });
});
