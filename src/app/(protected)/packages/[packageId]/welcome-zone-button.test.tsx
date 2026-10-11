import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/shared/domain/result";

import type { PackageGroupsClient } from "../_lib/package-groups-client";
import { WelcomeZoneButton } from "./welcome-zone-button";

const push = vi.fn();
const router = { push };

vi.mock("next/navigation", () => ({ useRouter: () => router }));

const catalogModule = (assetId: string, id: string, name: string) => ({
  areaM2: 2,
  assetId,
  depthM: 1,
  glbUrl: "https://example.com/m.glb",
  heightM: 1,
  id,
  name,
  posterUrl: null,
  priceCop: 100000,
  usdzUrl: "https://example.com/m.usdz",
  version: 1,
  widthM: 1,
});

const CATALOG = [
  catalogModule("pista", "id-pista", "Pista de baile"),
  catalogModule("arco", "id-arco", "Arco floral"),
  catalogModule("mesa", "id-mesa", "Mesa redonda"),
];

const catalogFetcher = (body: unknown = CATALOG, status = 200) =>
  vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status }));

function createClient(createGroup: PackageGroupsClient["createGroup"]): PackageGroupsClient {
  return { createGroup, mode: "live" };
}

describe("WelcomeZoneButton (Composite visible en la interfaz)", () => {
  beforeEach(() => {
    push.mockReset();
  });

  it("crea la Zona de bienvenida con el arco y la mesa del catálogo y muestra sus hijos", async () => {
    const createGroup = vi.fn().mockResolvedValue(
      ok({
        depth: 1,
        groupId: "grp-1",
        itemIds: ["item-a", "item-m"],
        name: "Zona de bienvenida",
        packageVersion: 3,
        parentGroupId: null,
      }),
    );

    render(<WelcomeZoneButton client={createClient(createGroup)} fetcher={catalogFetcher()} packageId="pkg-1" />);

    const button = screen.getByRole("button", { name: "Agregar Zona de bienvenida" });
    fireEvent.click(button);

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    const zone = await screen.findByRole("article", { name: "Zona de bienvenida" });
    expect(createGroup).toHaveBeenCalledWith("pkg-1", {
      moduleIds: ["id-arco", "id-mesa"],
      name: "Zona de bienvenida",
    });
    expect(within(zone).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Arco floral",
      "Mesa redonda",
    ]);
    expect(button).not.toBeDisabled();
  });

  it("muestra el error del servidor (p. ej. capacidad) y permite reintentar", async () => {
    const createGroup = vi.fn().mockResolvedValue(
      err({
        code: "package.capacity_exceeded",
        kind: "invalid" as const,
        message: 'No se agregó "Zona de bienvenida": excede la capacidad del espacio (32/30 m²).',
        status: 422,
      }),
    );

    render(<WelcomeZoneButton client={createClient(createGroup)} fetcher={catalogFetcher()} packageId="pkg-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Agregar Zona de bienvenida" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("excede la capacidad del espacio");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agregar Zona de bienvenida" })).not.toBeDisabled();
  });

  it("avisa si el catálogo no tiene el arco y la mesa, sin llamar a la API de grupos", async () => {
    const createGroup = vi.fn();

    render(
      <WelcomeZoneButton
        client={createClient(createGroup)}
        fetcher={catalogFetcher([CATALOG[0]])}
        packageId="pkg-1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Agregar Zona de bienvenida" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("arco floral y la mesa redonda");
    expect(createGroup).not.toHaveBeenCalled();
  });

  it("redirige a /login si la sesión expiró (401)", async () => {
    const createGroup = vi.fn().mockResolvedValue(
      err({ code: "auth.unauthenticated", kind: "unauthorized" as const, message: "Inicia sesión.", status: 401 }),
    );

    render(<WelcomeZoneButton client={createClient(createGroup)} fetcher={catalogFetcher()} packageId="pkg-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Agregar Zona de bienvenida" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });
});
