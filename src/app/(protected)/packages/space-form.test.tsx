import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/shared/domain/result";

import type { PackagesClient } from "./_lib/packages-client";
import { SpaceForm } from "./space-form";

const push = vi.fn();
// useRouter devuelve el mismo objeto en cada render, como en Next.js.
const router = { push };

vi.mock("next/navigation", () => ({ useRouter: () => router }));

function fakeClient(createPackage: PackagesClient["createPackage"]): PackagesClient {
  return { addItem: vi.fn(), createPackage, mode: "simulated" };
}

function fill(capacity: string, spaceLabel = "Salón social") {
  fireEvent.click(screen.getByLabelText(spaceLabel));
  fireEvent.change(screen.getByLabelText("Capacidad del espacio (m²)"), {
    target: { value: capacity },
  });
}

const submit = () => fireEvent.click(screen.getByRole("button", { name: "Crear paquete" }));

describe("SpaceForm", () => {
  beforeEach(() => push.mockReset());

  it("ofrece casa, aire libre y salón social", () => {
    render(<SpaceForm client={fakeClient(vi.fn())} />);

    expect(screen.getByRole("radio", { name: "Casa" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Aire libre (parque o playa)" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Salón social" })).toBeInTheDocument();
  });

  it("rechaza una capacidad inválida sin llamar a la API y conserva lo escrito", async () => {
    const createPackage = vi.fn();
    render(<SpaceForm client={fakeClient(createPackage)} />);

    fill("-3");
    submit();

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("La capacidad debe ser mayor que 0.");
    const input = screen.getByLabelText("Capacidad del espacio (m²)");
    expect(input).toHaveValue("-3");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain("capacityM2-error");
    expect(createPackage).not.toHaveBeenCalled();
  });

  it.each([
    ["abc", "La capacidad debe escribirse con números, por ejemplo 30."],
    ["30m2", "No aceptamos este valor. Escribe solo números, por ejemplo 30 o 30,5."],
  ])("explica por qué no acepta %j", async (raw, message) => {
    const createPackage = vi.fn();
    render(<SpaceForm client={fakeClient(createPackage)} />);

    fill(raw);
    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Capacidad del espacio (m²)")).toHaveValue(raw);
    expect(createPackage).not.toHaveBeenCalled();
  });

  it("pide elegir el tipo de espacio", async () => {
    render(<SpaceForm client={fakeClient(vi.fn())} />);

    fireEvent.change(screen.getByLabelText("Capacidad del espacio (m²)"), {
      target: { value: "30" },
    });
    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Elige el tipo de espacio.");
  });

  it("crea el paquete y navega a su catálogo", async () => {
    const createPackage = vi
      .fn<PackagesClient["createPackage"]>()
      .mockResolvedValue(ok({ capacityM2: 30.5, id: "p-1", spaceType: "salonSocial" }));
    render(<SpaceForm client={fakeClient(createPackage)} />);

    fill("30,5");
    submit();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/packages/p-1"));
    expect(createPackage).toHaveBeenCalledWith({ capacityM2: 30.5, spaceType: "salonSocial" });
  });

  it("deshabilita el botón mientras se crea el paquete", async () => {
    let resolve: (value: Awaited<ReturnType<PackagesClient["createPackage"]>>) => void = () => {};
    const createPackage = vi.fn(
      () => new Promise<Awaited<ReturnType<PackagesClient["createPackage"]>>>((r) => (resolve = r)),
    );
    render(<SpaceForm client={fakeClient(createPackage)} />);

    fill("30");
    submit();

    const button = await screen.findByRole("button", { name: "Creando tu paquete…" });
    expect(button).toBeDisabled();

    resolve(err({ kind: "invalid", message: "Capacidad inválida.", status: 422 }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Capacidad inválida.");
    expect(screen.getByRole("button", { name: "Crear paquete" })).toBeEnabled();
  });

  it("vuelve al login si la sesión terminó", async () => {
    const createPackage = vi
      .fn<PackagesClient["createPackage"]>()
      .mockResolvedValue(err({ kind: "unauthorized", message: "Sesión terminada", status: 401 }));
    render(<SpaceForm client={fakeClient(createPackage)} />);

    fill("30");
    submit();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });
});
