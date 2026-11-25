import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PackageDetailNode } from "@/modules/packages/application/dtos/package-detail.dto";
import { err, ok } from "@/shared/domain/result";

import type { PackagesClient } from "../_lib/packages-client";
import { PackageContents } from "./package-contents";

const push = vi.fn();
const refresh = vi.fn();
const router = { push, refresh };

vi.mock("next/navigation", () => ({ useRouter: () => router }));

function client(removeItem: PackagesClient["removeItem"] = vi.fn()): PackagesClient {
  return { addItem: vi.fn(), clonePackage: vi.fn(), createPackage: vi.fn(), mode: "live", moveItem: vi.fn(), removeItem, updateMetadata: vi.fn() };
}

const leaf = (itemId: string, moduleId: string, name: string, areaM2: number, priceCop: number): PackageDetailNode => ({
  areaM2,
  itemId,
  kind: "leaf",
  moduleId,
  name,
  priceCop,
});

const NODES: PackageDetailNode[] = [
  {
    areaM2: 6,
    children: [leaf("i-arco", "arco", "Arco floral", 2, 200000), leaf("i-mesa", "mesa", "Mesa redonda", 4, 250000)],
    groupId: "zona",
    kind: "group",
    name: "Zona de bienvenida",
    priceCop: 450000,
  },
  leaf("i-p1", "pista", "Pista de baile", 16, 600000),
  leaf("i-p2", "pista", "Pista de baile", 16, 600000),
];

const visible = (text: string | null) => (text ?? "").replace(/\s/g, " ");

describe("PackageContents (DECOR-22)", () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
  });

  it("muestra las hojas agrupadas con cantidad y subtotal informativo", () => {
    render(<PackageContents client={client()} nodes={NODES} packageId="pkg-1" version={3} />);

    const pista = screen.getByText("Pista de baile").closest("li") as HTMLElement;
    expect(within(pista).getByText("×2")).toBeInTheDocument();
    expect(visible(within(pista).getByText(/1\.200\.000/).textContent)).toBe("$ 1.200.000 · 32 m²");
    expect(screen.getByText(/subtotales son informativos/)).toBeInTheDocument();
  });

  it("sin zonas: las unidades guardadas dentro de un grupo se ven en la misma lista", () => {
    render(<PackageContents client={client()} nodes={NODES} packageId="pkg-1" version={3} />);

    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.querySelector(".content-name")?.textContent)).toEqual([
      "Arco floral",
      "Mesa redonda",
      "Pista de baile",
    ]);
    expect(screen.queryByText("Zona de bienvenida")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Opciones de/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre de la zona")).not.toBeInTheDocument();
  });

  it("junta las unidades del mismo módulo aunque estén en grupos distintos", () => {
    const nodes: PackageDetailNode[] = [
      { areaM2: 2, children: [leaf("i-a1", "arco", "Arco floral", 2, 200000)], groupId: "g-1", kind: "group", name: "A", priceCop: 200000 },
      leaf("i-a2", "arco", "Arco floral", 2, 200000),
    ];
    render(<PackageContents client={client()} nodes={nodes} packageId="pkg-1" version={3} />);

    const arco = screen.getByText("Arco floral").closest("li") as HTMLElement;
    expect(within(arco).getByText("×2")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("quitar una unidad llama a DELETE con un itemId de esa fila y refresca la página", async () => {
    const removeItem = vi.fn<PackagesClient["removeItem"]>().mockResolvedValue(ok(undefined));
    render(<PackageContents client={client(removeItem)} nodes={NODES} packageId="pkg-1" version={3} />);

    fireEvent.click(screen.getByRole("button", { name: "Quitar una unidad de Pista de baile" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(removeItem).toHaveBeenCalledWith("pkg-1", "i-p2");
    expect(screen.getByText("Se quitó una unidad de Pista de baile.")).toBeInTheDocument();
  });

  it("mientras quita marca el botón ocupado sin deshabilitarlo e ignora otros clics", async () => {
    let resolveRemove: (value: Awaited<ReturnType<PackagesClient["removeItem"]>>) => void = () => {};
    const removeItem = vi.fn(
      () => new Promise<Awaited<ReturnType<PackagesClient["removeItem"]>>>((resolve) => (resolveRemove = resolve)),
    );
    render(<PackageContents client={client(removeItem)} nodes={NODES} packageId="pkg-1" version={3} />);

    fireEvent.click(screen.getByRole("button", { name: "Quitar una unidad de Pista de baile" }));

    const busy = await screen.findByRole("button", { name: "Quitando Pista de baile" });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(busy).toBeEnabled();
    fireEvent.click(busy);
    expect(removeItem).toHaveBeenCalledTimes(1);

    resolveRemove(ok(undefined));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("si quitar falla, muestra el error junto al elemento, no refresca y permite reintentar", async () => {
    const removeItem = vi
      .fn<PackagesClient["removeItem"]>()
      .mockResolvedValueOnce(
        err({ code: "package.version_conflict", kind: "invalid", message: "El paquete cambió.", status: 409 }),
      )
      .mockResolvedValueOnce(ok(undefined));
    render(<PackageContents client={client(removeItem)} nodes={NODES} packageId="pkg-1" version={3} />);

    const button = screen.getByRole("button", { name: "Quitar una unidad de Pista de baile" });
    fireEvent.click(button);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("El paquete cambió.");
    expect(button).toHaveAttribute("aria-describedby", alert.id);
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByText("×2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Quitar una unidad de Pista de baile" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("si el elemento ya no existe (404) muestra el error y resincroniza con el servidor", async () => {
    const removeItem = vi
      .fn<PackagesClient["removeItem"]>()
      .mockResolvedValue(
        err({ code: "package.item_not_found", kind: "not_found", message: "Ya no está.", status: 404 }),
      );
    render(<PackageContents client={client(removeItem)} nodes={NODES} packageId="pkg-1" version={3} />);

    fireEvent.click(screen.getByRole("button", { name: "Quitar una unidad de Pista de baile" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ya no está.");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("un error de una versión anterior desaparece cuando llegan datos nuevos del servidor", async () => {
    const removeItem = vi
      .fn<PackagesClient["removeItem"]>()
      .mockResolvedValue(err({ code: "package.version_conflict", kind: "invalid", message: "Conflicto.", status: 409 }));
    const { rerender } = render(
      <PackageContents client={client(removeItem)} nodes={NODES} packageId="pkg-1" version={3} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Quitar una unidad de Pista de baile" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Conflicto.");

    rerender(<PackageContents client={client(removeItem)} nodes={NODES} packageId="pkg-1" version={4} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("al quitar la última unidad de una fila el foco pasa al título del contenido", async () => {
    const removeItem = vi.fn<PackagesClient["removeItem"]>().mockResolvedValue(ok(undefined));
    render(
      <PackageContents
        client={client(removeItem)}
        nodes={[leaf("i-arco", "arco", "Arco floral", 2, 200000)]}
        packageId="pkg-1"
        version={3}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Quitar una unidad de Arco floral" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Contenido del evento" })).toHaveFocus(),
    );
  });

  it("con sesión vencida (401) va a /login", async () => {
    const removeItem = vi
      .fn<PackagesClient["removeItem"]>()
      .mockResolvedValue(err({ code: "auth.unauthenticated", kind: "unauthorized", message: "x", status: 401 }));
    render(<PackageContents client={client(removeItem)} nodes={NODES} packageId="pkg-1" version={3} />);

    fireEvent.click(screen.getByRole("button", { name: "Quitar una unidad de Pista de baile" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });

  it("también se puede quitar una unidad guardada dentro de un grupo", async () => {
    const removeItem = vi.fn<PackagesClient["removeItem"]>().mockResolvedValue(ok(undefined));
    render(<PackageContents client={client(removeItem)} nodes={NODES} packageId="pkg-1" version={3} />);

    fireEvent.click(screen.getByRole("button", { name: "Quitar una unidad de Mesa redonda" }));

    await waitFor(() => expect(removeItem).toHaveBeenCalledWith("pkg-1", "i-mesa"));
  });

  it("paquete vacío: invita a agregar desde el catálogo", () => {
    render(<PackageContents client={client()} nodes={[]} packageId="pkg-1" version={3} />);

    expect(screen.getByText(/todavía no tiene elementos/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir al catálogo" })).toHaveAttribute("href", "/packages/pkg-1?seccion=catalogo");
  });

  it("quitar una unidad es un botón de ícono con nombre accesible", () => {
    render(<PackageContents client={client()} nodes={NODES} packageId="pkg-1" version={3} />);

    const remove = screen.getByRole("button", { name: "Quitar una unidad de Pista de baile" });
    expect(remove).toHaveClass("icon-button");
    expect(remove).toHaveTextContent("");
  });
});
