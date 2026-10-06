import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogModuleDto } from "@/modules/catalog/application/dtos/catalog-module.dto";
import { err, ok } from "@/shared/domain/result";

import type { PackagesClient } from "../_lib/packages-client";
import { PackageCatalog } from "./package-catalog";

const push = vi.fn();
// useRouter devuelve el mismo objeto en cada render, como en Next.js.
const router = { push };

vi.mock("next/navigation", () => ({ useRouter: () => router }));

const fixture = JSON.parse(
  readFileSync(resolve("public/fixtures/catalog-modules.json"), "utf8"),
) as CatalogModuleDto[];

function client(addItem: PackagesClient["addItem"] = vi.fn()): PackagesClient {
  return { addItem, createPackage: vi.fn(), mode: "live" };
}

const visible = (text: string | null) => (text ?? "").replace(/\s/g, " ");

describe("PackageCatalog", () => {
  beforeEach(() => push.mockReset());

  it("muestra el estado de carga y luego una tarjeta por módulo con precio COP y área", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    render(<PackageCatalog client={client()} fetcher={fetcher} packageId="p-1" />);

    expect(screen.getByText("Cargando catálogo…")).toBeInTheDocument();

    const cards = await screen.findAllByRole("article");
    expect(cards).toHaveLength(3);

    const mesa = within(cards[0]);
    expect(mesa.getByRole("heading", { name: "Mesa redonda" })).toBeInTheDocument();
    expect(visible(mesa.getByText(/250\.000/).textContent)).toBe("$ 250.000");
    expect(mesa.getByText("4 m²")).toBeInTheDocument();
    expect(mesa.getByRole("img", { name: "Vista previa de Mesa redonda" })).toHaveAttribute(
      "src",
      "https://example.com/posters/mesa.webp",
    );
    expect(fetcher).toHaveBeenCalledWith("/api/modules", expect.anything());
  });

  it("muestra un marcador cuando el módulo no tiene imagen", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json([{ ...fixture[0], posterUrl: null }]));
    render(<PackageCatalog client={client()} fetcher={fetcher} packageId="p-1" />);

    expect(await screen.findByRole("img", { name: "Mesa redonda sin imagen" })).toBeInTheDocument();
  });

  it("muestra el estado vacío", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json([]));
    render(<PackageCatalog client={client()} fetcher={fetcher} packageId="p-1" />);

    expect(
      await screen.findByText("Todavía no hay módulos disponibles en el catálogo."),
    ).toBeInTheDocument();
  });

  it("muestra el error y se recupera al reintentar", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ error: "Internal Server Error", correlationId: "c" }, { status: 500 }),
      )
      .mockResolvedValueOnce(Response.json(fixture));
    render(<PackageCatalog client={client()} fetcher={fetcher} packageId="p-1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar el catálogo.");

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findAllByRole("article")).toHaveLength(3);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("agrega el módulo al paquete y lo anuncia", async () => {
    const addItem = vi
      .fn<PackagesClient["addItem"]>()
      .mockResolvedValue(ok({ itemId: "i-1", packageVersion: 2 }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    render(<PackageCatalog client={client(addItem)} fetcher={fetcher} packageId="p-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Agregar Arco floral" }));

    await waitFor(() =>
      expect(screen.getByText("Arco floral se agregó a tu paquete.")).toBeInTheDocument(),
    );
    expect(addItem).toHaveBeenCalledWith("p-1", fixture[1].id);
    expect(screen.getByText("Agregado a tu paquete")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Agregar Arco floral" }));

    expect(await screen.findByText("Agregado 2 veces")).toBeInTheDocument();
  });

  it("marca el botón como ocupado sin deshabilitarlo e ignora clics repetidos", async () => {
    let resolveAdd: (value: Awaited<ReturnType<PackagesClient["addItem"]>>) => void = () => {};
    const addItem = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<PackagesClient["addItem"]>>>((r) => (resolveAdd = r)),
    );
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    render(<PackageCatalog client={client(addItem)} fetcher={fetcher} packageId="p-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Agregar Mesa redonda" }));

    const busy = await screen.findByRole("button", { name: "Agregando Mesa redonda" });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    // Un botón `disabled` perdería el foco del teclado.
    expect(busy).toBeEnabled();

    fireEvent.click(busy);
    expect(addItem).toHaveBeenCalledTimes(1);

    resolveAdd(ok({ itemId: "i-1", packageVersion: 2 }));

    expect(await screen.findByRole("button", { name: "Agregar Mesa redonda" })).not.toHaveAttribute(
      "aria-disabled",
    );
  });

  it("muestra el error de agregar junto a la tarjeta", async () => {
    const addItem = vi
      .fn<PackagesClient["addItem"]>()
      .mockResolvedValue(
        err({ code: "package.capacity_exceeded", kind: "invalid", message: "Excede la capacidad.", status: 422 }),
      );
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    render(<PackageCatalog client={client(addItem)} fetcher={fetcher} packageId="p-1" />);

    const button = await screen.findByRole("button", { name: "Agregar Pista de baile" });
    fireEvent.click(button);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Excede la capacidad.");
    expect(screen.getByRole("button", { name: "Agregar Pista de baile" })).toHaveAttribute(
      "aria-describedby",
      alert.id,
    );
  });

  it("avisa cuando la API de paquetes está simulada", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json([]));
    render(
      <PackageCatalog
        client={{ ...client(), mode: "simulated" }}
        fetcher={fetcher}
        packageId="p-1"
      />,
    );

    expect(screen.getByText(/Modo simulado/)).toBeInTheDocument();
    await screen.findByText("Todavía no hay módulos disponibles en el catálogo.");
  });
});
