import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/shared/domain/result";

import type { PackageGroupsClient } from "../_lib/package-groups-client";
import type { ZoneOption } from "../_lib/zone-tree";
import { NewZoneForm } from "./new-zone-form";

const push = vi.fn();
const router = { push };

vi.mock("next/navigation", () => ({ useRouter: () => router }));

const zone = (groupId: string, name: string, depth: number): ZoneOption => ({
  ancestorIds: [],
  depth,
  descendantIds: [],
  groupId,
  height: 1,
  name,
});

const ZONES = [zone("g-1", "Recepción", 1), zone("g-2", "Mesa principal", 2), zone("g-3", "Nivel 3", 3)];

const CREATED = {
  depth: 1,
  groupId: "g-new",
  itemIds: [],
  name: "Recepción",
  packageVersion: 4,
  parentGroupId: null,
};

function fakeClient(createGroup: PackageGroupsClient["createGroup"]): PackageGroupsClient {
  return { createGroup, deleteGroup: vi.fn(), mode: "live", updateGroup: vi.fn() };
}

describe("NewZoneForm (alta inline de zonas)", () => {
  beforeEach(() => {
    push.mockReset();
  });

  it("crea la zona con el nombre recortado, el padre elegido y la versión observada", async () => {
    const createGroup = vi.fn<PackageGroupsClient["createGroup"]>().mockResolvedValue(ok(CREATED));
    const onCreated = vi.fn();

    render(
      <NewZoneForm
        allowParentSelect
        client={fakeClient(createGroup)}
        expectedVersion={3}
        onCreated={onCreated}
        packageId="pkg-1"
        zones={ZONES}
      />,
    );

    fireEvent.change(screen.getByLabelText("Nombre de la zona"), { target: { value: "  Recepción  " } });
    fireEvent.change(screen.getByLabelText("Zona padre (opcional)"), { target: { value: "g-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear zona" }));

    await waitFor(() => expect(createGroup).toHaveBeenCalledWith("pkg-1", {
      expectedVersion: 3,
      name: "Recepción",
      parentGroupId: "g-2",
    }));
    expect(onCreated).toHaveBeenCalledWith(CREATED);
    expect(screen.getByLabelText("Nombre de la zona")).toHaveValue("");
  });

  it("no ofrece como padre una zona de nivel 3", () => {
    render(
      <NewZoneForm allowParentSelect client={fakeClient(vi.fn())} packageId="pkg-1" zones={ZONES} />,
    );

    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["Sin zona (raíz)", "Recepción", "· Mesa principal"]);
  });

  it("valida el nombre vacío con aria-invalid y aria-describedby sin llamar a la API", () => {
    const createGroup = vi.fn();

    render(<NewZoneForm client={fakeClient(createGroup)} packageId="pkg-1" zones={ZONES} />);

    fireEvent.click(screen.getByRole("button", { name: "Crear zona" }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/nombre/i);
    const input = screen.getByLabelText("Nombre de la zona");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", alert.id);
    expect(createGroup).not.toHaveBeenCalled();
  });

  it("valida el límite de 80 caracteres", () => {
    const createGroup = vi.fn();

    render(<NewZoneForm client={fakeClient(createGroup)} packageId="pkg-1" zones={ZONES} />);

    fireEvent.change(screen.getByLabelText("Nombre de la zona"), { target: { value: "x".repeat(81) } });
    fireEvent.click(screen.getByRole("button", { name: "Crear zona" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/80/);
    expect(createGroup).not.toHaveBeenCalled();
  });

  it("impide un segundo envío mientras la primera creación está en curso", async () => {
    let resolve: (value: Awaited<ReturnType<PackageGroupsClient["createGroup"]>>) => void = () => {};
    const createGroup = vi.fn(() => new Promise<Awaited<ReturnType<PackageGroupsClient["createGroup"]>>>((r) => (resolve = r)));

    render(<NewZoneForm client={fakeClient(createGroup)} packageId="pkg-1" zones={ZONES} />);

    fireEvent.change(screen.getByLabelText("Nombre de la zona"), { target: { value: "Sala" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear zona" }));

    fireEvent.click(screen.getByRole("button", { name: "Creando…" }));
    expect(createGroup).toHaveBeenCalledTimes(1);

    resolve(ok(CREATED));
    await waitFor(() => expect(screen.getByLabelText("Nombre de la zona")).toHaveValue(""));
  });

  it("muestra el error del servidor y deja reintentar", async () => {
    const createGroup = vi.fn<PackageGroupsClient["createGroup"]>().mockResolvedValue(
      err({ code: "package.group_depth_exceeded", kind: "invalid", message: "Máximo 3 niveles.", status: 422 }),
    );

    render(<NewZoneForm client={fakeClient(createGroup)} packageId="pkg-1" zones={ZONES} />);

    fireEvent.change(screen.getByLabelText("Nombre de la zona"), { target: { value: "Sala" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear zona" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Máximo 3 niveles.");
    expect(screen.getByRole("button", { name: "Crear zona" })).toBeInTheDocument();
  });

  it("redirige a /login si la sesión expiró (401)", async () => {
    const createGroup = vi.fn<PackageGroupsClient["createGroup"]>().mockResolvedValue(
      err({ code: "auth.unauthenticated", kind: "unauthorized", message: "Inicia sesión.", status: 401 }),
    );

    render(<NewZoneForm client={fakeClient(createGroup)} packageId="pkg-1" zones={ZONES} />);

    fireEvent.change(screen.getByLabelText("Nombre de la zona"), { target: { value: "Sala" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear zona" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });

  it("con un padre fijo crea una subzona y no muestra selector", async () => {
    const createGroup = vi.fn<PackageGroupsClient["createGroup"]>().mockResolvedValue(ok(CREATED));

    render(
      <NewZoneForm
        client={fakeClient(createGroup)}
        packageId="pkg-1"
        parentGroupId="g-1"
        parentName="Recepción"
        submitLabel="Crear subzona"
        zones={ZONES}
      />,
    );

    expect(screen.queryByLabelText("Zona padre (opcional)")).not.toBeInTheDocument();
    expect(screen.getByText("Dentro de Recepción.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nombre de la zona"), { target: { value: "Mesa" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear subzona" }));

    await waitFor(() => expect(createGroup).toHaveBeenCalledWith("pkg-1", {
      name: "Mesa",
      parentGroupId: "g-1",
    }));
  });
});
