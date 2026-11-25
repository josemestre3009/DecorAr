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

const cardOf = async (name: string) =>
  (await screen.findByRole("heading", { name })).closest("article") as HTMLElement;

/** Abre la hoja inferior de un módulo (rediseño visual móvil) y consulta dentro de ella. */
async function openSheet(name: string) {
  const card = await cardOf(name);
  fireEvent.click(within(card).getByRole("button", { name: `Agregar ${name}` }));
  return within(await within(card).findByRole("dialog"));
}

/** La hoja se cierra con una animación corta. */
async function sheetClosed(name: string) {
  const card = await cardOf(name);
  await waitFor(() => expect(within(card).queryByRole("dialog")).not.toBeInTheDocument());
}

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

  it("agrega el módulo al paquete desde la hoja y lo anuncia", async () => {
    const addItem = vi
      .fn<PackagesClient["addItem"]>()
      .mockResolvedValue(ok({ itemId: "i-1", packageVersion: 2 }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    render(<PackageCatalog client={client(addItem)} fetcher={fetcher} packageId="p-1" />);

    let sheet = await openSheet("Arco floral");
    fireEvent.click(sheet.getByRole("button", { name: "Agregar Arco floral" }));

    await waitFor(() =>
      expect(screen.getByText("Arco floral se agregó a tu evento.")).toBeInTheDocument(),
    );
    expect(addItem).toHaveBeenCalledWith("p-1", fixture[1].id);
    expect(screen.getByText("Agregado a tu evento")).toBeInTheDocument();
    await sheetClosed("Arco floral");

    sheet = await openSheet("Arco floral");
    fireEvent.click(sheet.getByRole("button", { name: "Agregar Arco floral" }));

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

    const sheet = await openSheet("Arco floral");
    const increase = sheet.getByRole("button", { name: "Aumentar cantidad de Arco floral" });
    fireEvent.click(increase);
    fireEvent.click(increase);

    expect(sheet.getByRole("status")).toHaveTextContent("3");
    expect(increase).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(increase);
    expect(sheet.getByRole("status")).toHaveTextContent("3");
    expect(sheet.getByText("Máximo 3 según el espacio disponible.")).toBeInTheDocument();

    fireEvent.click(sheet.getByRole("button", { name: "Agregar 3 unidades de Arco floral" }));

    await waitFor(() => expect(addItem).toHaveBeenCalledWith("p-1", fixture[1].id, 3));
    expect(screen.getByText("3 unidades de Arco floral se agregaron a tu evento.")).toBeInTheDocument();
    expect(screen.getByText("Agregado 3 veces")).toBeInTheDocument();
    // Tras el éxito la hoja se cierra y el foco vuelve al "+" de la tarjeta.
    await sheetClosed("Arco floral");
    expect(screen.getByRole("button", { name: "Agregar Arco floral" })).toHaveFocus();
  });

  it("muestra el total en vivo según la cantidad", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    render(<PackageCatalog client={client()} fetcher={fetcher} packageId="p-1" />);

    const sheet = await openSheet("Arco floral");
    fireEvent.click(sheet.getByRole("button", { name: "Aumentar cantidad de Arco floral" }));

    expect(visible(sheet.getByText(/^2 ×/).textContent)).toBe("2 × $ 200.000");
    expect(visible(sheet.getByText(/400\.000/).textContent)).toBe("$ 400.000");
  });

  it("al reabrir la hoja la cantidad vuelve a 1", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    render(<PackageCatalog client={client()} fetcher={fetcher} packageId="p-1" />);

    let sheet = await openSheet("Arco floral");
    fireEvent.click(sheet.getByRole("button", { name: "Aumentar cantidad de Arco floral" }));
    fireEvent.click(sheet.getByRole("button", { name: "Cerrar" }));
    await sheetClosed("Arco floral");

    sheet = await openSheet("Arco floral");
    expect(sheet.getByRole("status")).toHaveTextContent("1");
  });

  it("ajusta el máximo cuando el espacio se reduce al agregar otro módulo", async () => {
    const addItem = vi
      .fn<PackagesClient["addItem"]>()
      .mockResolvedValue(ok({ itemId: "i-1", packageVersion: 2 }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    render(<PackageCatalog client={client(addItem)} fetcher={fetcher} packageId="p-1" remainingM2={6} />);

    // Mesa redonda ocupa 4 m² y deja 2 m²: Arco floral (2 m²) baja a máximo 1.
    const mesa = await openSheet("Mesa redonda");
    fireEvent.click(mesa.getByRole("button", { name: "Agregar Mesa redonda" }));
    await waitFor(() => expect(addItem).toHaveBeenCalledWith("p-1", fixture[0].id));
    await sheetClosed("Mesa redonda");

    const arco = await openSheet("Arco floral");
    expect(arco.getByText("Máximo 1 según el espacio disponible.")).toBeInTheDocument();
    expect(arco.getByRole("button", { name: "Aumentar cantidad de Arco floral" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    fireEvent.click(arco.getByRole("button", { name: "Agregar Arco floral" }));
    await waitFor(() => expect(addItem).toHaveBeenCalledWith("p-1", fixture[1].id));
  });

  it("no convierte la cantidad a 0 cuando el espacio se agota y bloquea el botón", async () => {
    const addItem = vi
      .fn<PackagesClient["addItem"]>()
      .mockResolvedValue(ok({ itemId: "i-1", packageVersion: 2 }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    render(<PackageCatalog client={client(addItem)} fetcher={fetcher} packageId="p-1" remainingM2={5} />);

    // Mesa redonda ocupa 4 m²: queda 1 m², insuficiente para otra unidad de Arco floral.
    const mesa = await openSheet("Mesa redonda");
    fireEvent.click(mesa.getByRole("button", { name: "Agregar Mesa redonda" }));
    await waitFor(() => expect(addItem).toHaveBeenCalledWith("p-1", fixture[0].id));
    await sheetClosed("Mesa redonda");

    const arco = await openSheet("Arco floral");
    expect(arco.getByRole("status")).toHaveTextContent("1");
    expect(arco.getByText("No queda espacio para otra unidad.")).toBeInTheDocument();
    const confirm = arco.getByRole("button", { name: "Agregar Arco floral" });
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(confirm);
    expect(addItem).toHaveBeenCalledTimes(1);
  });

  it("explica y bloquea la acción cuando no cabe una unidad", async () => {
    const addItem = vi.fn<PackagesClient["addItem"]>();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json([fixture[0]]));
    render(<PackageCatalog client={client(addItem)} fetcher={fetcher} packageId="p-1" remainingM2={3} />);

    const sheet = await openSheet("Mesa redonda");
    expect(sheet.getByText("No queda espacio para otra unidad.")).toBeInTheDocument();
    const button = sheet.getByRole("button", { name: "Agregar Mesa redonda" });
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

    const sheet = await openSheet("Arco floral");
    fireEvent.click(sheet.getByRole("button", { name: "Agregar Arco floral" }));

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

    const sheet = await openSheet("Mesa redonda");
    fireEvent.click(sheet.getByRole("button", { name: "Agregar Mesa redonda" }));

    const busy = await sheet.findByRole("button", { name: "Agregando Mesa redonda" });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    // Un botón `disabled` perdería el foco del teclado.
    expect(busy).toBeEnabled();

    fireEvent.click(busy);
    expect(addItem).toHaveBeenCalledTimes(1);

    resolveAdd(ok({ itemId: "i-1", packageVersion: 2 }));

    await sheetClosed("Mesa redonda");
    expect(screen.getByRole("button", { name: "Agregar Mesa redonda" })).not.toHaveAttribute("aria-busy");
  });

  it("muestra el error de agregar en la hoja y la deja abierta", async () => {
    const addItem = vi
      .fn<PackagesClient["addItem"]>()
      .mockResolvedValue(
        err({ code: "package.capacity_exceeded", kind: "invalid", message: "Excede la capacidad.", status: 422 }),
      );
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    render(<PackageCatalog client={client(addItem)} fetcher={fetcher} packageId="p-1" />);

    const sheet = await openSheet("Pista de baile");
    fireEvent.click(sheet.getByRole("button", { name: "Agregar Pista de baile" }));

    const alert = await sheet.findByRole("alert");
    expect(alert).toHaveTextContent("Excede la capacidad.");
    expect(sheet.getByRole("button", { name: "Agregar Pista de baile" })).toHaveAttribute(
      "aria-describedby",
      alert.id,
    );
    expect(sheet.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
    // Un 422 no muta la interfaz: no se refresca el contenido (DECOR-22).
    expect(refresh).not.toHaveBeenCalled();
  });

  it("muestra un aviso visual al agregar varias unidades", async () => {
    const addItem = vi.fn<PackagesClient["addItem"]>().mockResolvedValue(ok({ itemId: "i-1", packageVersion: 2 }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    const { container } = render(<PackageCatalog client={client(addItem)} fetcher={fetcher} packageId="p-1" />);

    const sheet = await openSheet("Arco floral");
    fireEvent.click(sheet.getByRole("button", { name: "Aumentar cantidad de Arco floral" }));
    fireEvent.click(sheet.getByRole("button", { name: "Agregar 2 unidades de Arco floral" }));

    await waitFor(() => expect(container.querySelector(".catalog-toast")).toHaveTextContent("2 × Arco floral agregados"));
    // Es solo visual: la región viva ya lo anuncia.
    expect(container.querySelector(".catalog-toast")).toHaveAttribute("aria-hidden", "true");
  });

  it("filtra el catálogo por nombre sin importar tildes ni mayúsculas", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    render(<PackageCatalog client={client()} fetcher={fetcher} packageId="p-1" />);

    const search = await screen.findByRole("searchbox", { name: "Buscar en el catálogo" });
    fireEvent.change(search, { target: { value: "ARCÓ" } });

    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Arco floral" })).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "trono" } });
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByText("No encontramos elementos con «trono».")).toBeInTheDocument();
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


describe("PackageCatalog: sin zonas (retiradas de la interfaz)", () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
  });

  it("la hoja no ofrece elegir zona y agrega siempre al evento", async () => {
    const addItem = vi.fn<PackagesClient["addItem"]>().mockResolvedValue(ok({ itemId: "i-1", packageVersion: 2 }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    render(<PackageCatalog client={client(addItem)} fetcher={fetcher} packageId="p-1" />);

    const sheet = await openSheet("Arco floral");
    expect(sheet.queryByRole("radio")).not.toBeInTheDocument();
    expect(sheet.queryByRole("group", { name: "Zona" })).not.toBeInTheDocument();
    fireEvent.click(sheet.getByRole("button", { name: "Agregar Arco floral" }));

    await waitFor(() => expect(addItem).toHaveBeenCalledWith("p-1", fixture[1]?.id));
  });
});
