import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogModuleDto } from "@/modules/catalog/application/dtos/catalog-module.dto";
import { err, ok } from "@/shared/domain/result";

import type { PackagesClient } from "../_lib/packages-client";
import type { ZoneOption } from "../_lib/zone-tree";
import { PackageCatalog } from "./package-catalog";

const push = vi.fn();
// useRouter devuelve el mismo objeto en cada render, como en Next.js.
const refresh = vi.fn();
const router = { push, refresh };

vi.mock("next/navigation", () => ({ useRouter: () => router }));

const fixture = JSON.parse(
  readFileSync(resolve("public/fixtures/catalog-modules.json"), "utf8"),
) as CatalogModuleDto[];

function client(addItem: PackagesClient["addItem"] = vi.fn()): PackagesClient {
  return { addItem, clonePackage: vi.fn(), createPackage: vi.fn(), mode: "live", moveItem: vi.fn(), removeItem: vi.fn(), updateMetadata: vi.fn() };
}

const visible = (text: string | null) => (text ?? "").replace(/\s/g, " ");

describe("PackageCatalog", () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
  });

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

  it("vuelve a consultar sin caché y muestra los módulos nuevos", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json(fixture));
    render(<PackageCatalog client={client()} fetcher={fetcher} packageId="p-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Volver a consultar" }));

    expect(await screen.findAllByRole("article")).toHaveLength(3);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({ cache: "no-store" });
    }
  });

  it("agrega el módulo al paquete y lo anuncia", async () => {
    const addItem = vi
      .fn<PackagesClient["addItem"]>()
      .mockResolvedValue(ok({ itemId: "i-1", packageVersion: 2 }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    render(<PackageCatalog client={client(addItem)} fetcher={fetcher} packageId="p-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Agregar Arco floral" }));

    await waitFor(() =>
      expect(screen.getByText("Arco floral se agregó a tu evento.")).toBeInTheDocument(),
    );
    expect(addItem).toHaveBeenCalledWith("p-1", fixture[1].id);
    expect(screen.getByText("Agregado a tu evento")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Agregar Arco floral" }));

    expect(await screen.findByText("Agregado 2 veces")).toBeInTheDocument();
    // Con la API real el contenido del paquete se vuelve a leer del servidor (DECOR-22).
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("selecciona varias unidades sin superar la capacidad y las agrega en una llamada", async () => {
    const addItem = vi.fn<PackagesClient["addItem"]>().mockResolvedValue(
      ok({ itemId: "i-1", itemIds: ["i-1", "i-2", "i-3"], packageVersion: 4 }),
    );
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    render(
      <PackageCatalog
        client={client(addItem)}
        fetcher={fetcher}
        packageId="p-1"
        remainingM2={6}
      />,
    );

    const increase = await screen.findByRole("button", { name: "Aumentar cantidad de Arco floral" });
    fireEvent.click(increase);
    fireEvent.click(increase);

    expect(screen.getByText("×3")).toBeInTheDocument();
    expect(increase).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(increase);
    expect(screen.getByText("×3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Agregar 3 unidades de Arco floral" }));

    await waitFor(() => expect(addItem).toHaveBeenCalledWith("p-1", fixture[1].id, 3));
    expect(screen.getByText("3 unidades de Arco floral se agregaron a tu evento.")).toBeInTheDocument();
    expect(screen.getByText("Agregado 3 veces")).toBeInTheDocument();
    // Tras el éxito la cantidad vuelve a 1 y el nombre accesible del botón cambia.
    expect(screen.getByRole("button", { name: "Agregar Arco floral" })).toBeInTheDocument();
    expect(screen.queryByText("×3")).not.toBeInTheDocument();
  });

  it("ajusta la cantidad cuando el espacio se reduce al agregar otro módulo", async () => {
    const addItem = vi
      .fn<PackagesClient["addItem"]>()
      .mockResolvedValue(ok({ itemId: "i-1", packageVersion: 2 }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    render(<PackageCatalog client={client(addItem)} fetcher={fetcher} packageId="p-1" remainingM2={6} />);

    const increase = await screen.findByRole("button", { name: "Aumentar cantidad de Arco floral" });
    fireEvent.click(increase);
    fireEvent.click(increase);
    expect(screen.getByText("×3")).toBeInTheDocument();

    // Mesa redonda ocupa 4 m² y deja 2 m²: Arco floral (2 m²) baja a máximo 1.
    fireEvent.click(screen.getByRole("button", { name: "Agregar Mesa redonda" }));

    await waitFor(() => expect(addItem).toHaveBeenCalledWith("p-1", fixture[0].id));
    await waitFor(() => expect(screen.queryByText("×3")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Agregar Arco floral" }));
    await waitFor(() => expect(addItem).toHaveBeenCalledWith("p-1", fixture[1].id));
  });

  it("no convierte la cantidad a 0 cuando el espacio se agota y bloquea el botón", async () => {
    const addItem = vi
      .fn<PackagesClient["addItem"]>()
      .mockResolvedValue(ok({ itemId: "i-1", packageVersion: 2 }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    render(<PackageCatalog client={client(addItem)} fetcher={fetcher} packageId="p-1" remainingM2={5} />);

    const increase = await screen.findByRole("button", { name: "Aumentar cantidad de Arco floral" });
    fireEvent.click(increase);
    expect(screen.getByText("×2")).toBeInTheDocument();

    // Mesa redonda ocupa 4 m²: quedan 1 m², insuficientes para otra unidad de Arco floral.
    fireEvent.click(screen.getByRole("button", { name: "Agregar Mesa redonda" }));

    await waitFor(() => expect(addItem).toHaveBeenCalledWith("p-1", fixture[0].id));
    const arco = await screen.findByRole("button", { name: "Agregar Arco floral" });
    expect(arco).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(arco);
    expect(addItem).toHaveBeenCalledTimes(1);
  });

  it("explica y bloquea la acción cuando no cabe una unidad", async () => {
    const addItem = vi.fn<PackagesClient["addItem"]>();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json([fixture[0]]));
    render(<PackageCatalog client={client(addItem)} fetcher={fetcher} packageId="p-1" remainingM2={3} />);

    expect(await screen.findByText("No queda espacio para otra unidad.")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Agregar Mesa redonda" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(addItem).not.toHaveBeenCalled();
  });

  it("en modo simulado no refresca la página al agregar", async () => {
    const addItem = vi
      .fn<PackagesClient["addItem"]>()
      .mockResolvedValue(ok({ itemId: "i-1", packageVersion: 2 }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    render(
      <PackageCatalog client={{ ...client(addItem), mode: "simulated" }} fetcher={fetcher} packageId="p-1" />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Agregar Arco floral" }));

    await screen.findByText("Arco floral se agregó a tu evento.");
    expect(refresh).not.toHaveBeenCalled();
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
    // Un 422 no muta la interfaz: no se refresca el contenido (DECOR-22).
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reconcilia el contador con las unidades confirmadas por el servidor tras un refresco (DECOR-22)", async () => {
    const arcId = fixture[1]?.id as string;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    const { rerender } = render(
      <PackageCatalog client={client()} fetcher={fetcher} packageId="p-1" serverCounts={{ [arcId]: 2 }} />,
    );

    expect(await screen.findByText("Agregado 2 veces")).toBeInTheDocument();

    rerender(
      <PackageCatalog client={client()} fetcher={fetcher} packageId="p-1" serverCounts={{ [arcId]: 1 }} />,
    );

    expect(await screen.findByText("Agregado a tu evento")).toBeInTheDocument();
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

describe("PackageCatalog: acceso a la vista 3D (DECOR-23)", () => {
  it("cada tarjeta enlaza a su vista 3D dentro del paquete", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    render(<PackageCatalog client={client()} fetcher={fetcher} packageId="p-1" />);

    const links = await screen.findAllByRole("link", { name: /^Ver .+ en 3D$/ });

    expect(links).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Ver Mesa redonda en 3D" })).toHaveAttribute(
      "href",
      `/packages/p-1/modules/${fixture[0]?.id}`,
    );
  });
});

const ZONES: ZoneOption[] = [
  { ancestorIds: [], depth: 1, descendantIds: [], groupId: "g-1", height: 1, name: "Recepción" },
];

const cardOf = async (name: string) =>
  (await screen.findByRole("heading", { name })).closest("article") as HTMLElement;

describe("PackageCatalog: destino por zona para agregar módulos", () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
  });

  it("agrega a la zona elegida con una sola instancia", async () => {
    const addItem = vi.fn<PackagesClient["addItem"]>().mockResolvedValue(ok({ itemId: "i-1", packageVersion: 2 }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    render(<PackageCatalog client={client(addItem)} fetcher={fetcher} packageId="p-1" zones={ZONES} />);

    const card = await cardOf("Arco floral");
    fireEvent.change(within(card).getByLabelText("Zona"), { target: { value: "g-1" } });
    fireEvent.click(within(card).getByRole("button", { name: "Agregar Arco floral" }));

    await waitFor(() => expect(addItem).toHaveBeenCalledWith("p-1", fixture[1]?.id, 1, "g-1"));
    expect(refresh).toHaveBeenCalled();
  });

  it("mantiene la acción rápida a la raíz sin seleccionar zona", async () => {
    const addItem = vi.fn<PackagesClient["addItem"]>().mockResolvedValue(ok({ itemId: "i-1", packageVersion: 2 }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    render(<PackageCatalog client={client(addItem)} fetcher={fetcher} packageId="p-1" zones={ZONES} />);

    const card = await cardOf("Arco floral");
    expect(within(card).getByLabelText("Zona")).toHaveValue("");
    fireEvent.click(within(card).getByRole("button", { name: "Agregar Arco floral" }));

    await waitFor(() => expect(addItem).toHaveBeenCalledWith("p-1", fixture[1]?.id));
  });

  it("no bloquea por exceso de área cuando se agrega a una zona", async () => {
    const addItem = vi.fn<PackagesClient["addItem"]>().mockResolvedValue(ok({ itemId: "i-1", packageVersion: 2 }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    render(
      <PackageCatalog client={client(addItem)} fetcher={fetcher} packageId="p-1" remainingM2={3} zones={ZONES} />,
    );

    const card = await cardOf("Mesa redonda");
    const withoutZone = within(card).getByRole("button", { name: "Agregar Mesa redonda" });
    expect(withoutZone).toHaveAttribute("aria-disabled", "true");

    fireEvent.change(within(card).getByLabelText("Zona"), { target: { value: "g-1" } });
    const withZone = within(card).getByRole("button", { name: "Agregar Mesa redonda" });
    expect(withZone).not.toHaveAttribute("aria-disabled");

    fireEvent.click(withZone);
    await waitFor(() => expect(addItem).toHaveBeenCalledWith("p-1", fixture[0]?.id, 1, "g-1"));
  });

  it("sin zonas no muestra el selector de destino", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    render(<PackageCatalog client={client()} fetcher={fetcher} packageId="p-1" />);

    await screen.findAllByRole("article");
    expect(screen.queryByLabelText("Zona")).not.toBeInTheDocument();
  });
});
