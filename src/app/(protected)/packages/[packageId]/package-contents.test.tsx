import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PackageDetailNode } from "@/modules/packages/application/dtos/package-detail.dto";
import { err, ok } from "@/shared/domain/result";

import type { PackagesClient } from "../_lib/packages-client";
import type { PackageGroupsClient } from "../_lib/package-groups-client";
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

  it("la Zona de bienvenida se despliega con aria-expanded y muestra arco + mesa", () => {
    render(<PackageContents client={client()} nodes={NODES} packageId="pkg-1" version={3} />);

    const toggle = screen.getByRole("button", { name: /Zona de bienvenida/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("2 elementos");
    const children = document.getElementById(toggle.getAttribute("aria-controls") as string) as HTMLElement;
    expect(children).not.toBeVisible();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(children).toBeVisible();
    expect(within(children).getByText("Arco floral")).toBeInTheDocument();
    expect(within(children).getByText("Mesa redonda")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
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

  it("también se puede quitar una hoja que está dentro de un grupo", async () => {
    const removeItem = vi.fn<PackagesClient["removeItem"]>().mockResolvedValue(ok(undefined));
    render(<PackageContents client={client(removeItem)} nodes={NODES} packageId="pkg-1" version={3} />);

    fireEvent.click(screen.getByRole("button", { name: /Zona de bienvenida/ }));
    fireEvent.click(screen.getByRole("button", { name: "Quitar una unidad de Mesa redonda" }));

    await waitFor(() => expect(removeItem).toHaveBeenCalledWith("pkg-1", "i-mesa"));
  });

  it("paquete vacío: invita a agregar desde el catálogo", () => {
    render(<PackageContents client={client()} nodes={[]} packageId="pkg-1" version={3} />);

    expect(screen.getByText(/todavía no tiene elementos/)).toBeInTheDocument();
  });
});

const groupNode = (
  groupId: string,
  name: string,
  children: PackageDetailNode[],
): PackageDetailNode => ({ areaM2: 4, children, groupId, kind: "group", name, priceCop: 100 });

// Zona A → Zona B y una Zona C hermana en la raíz: alcanza para mover y anidar.
const NESTED: PackageDetailNode[] = [
  groupNode("zona-a", "Zona A", [
    leaf("i-mesa", "mesa", "Mesa redonda", 4, 250000),
    groupNode("zona-b", "Zona B", [leaf("i-arco", "arco", "Arco floral", 2, 200000)]),
  ]),
  groupNode("zona-c", "Zona C", []),
];

function groupsClient(partial: Partial<PackageGroupsClient> = {}): PackageGroupsClient {
  return {
    createGroup: vi.fn().mockResolvedValue(
      ok({ depth: 2, groupId: "g-new", itemIds: [], name: "Nueva", packageVersion: 4, parentGroupId: "zona-a" }),
    ),
    deleteGroup: vi.fn().mockResolvedValue(ok({ packageVersion: 4 })),
    mode: "live",
    updateGroup: vi.fn().mockResolvedValue(ok({ packageVersion: 4 })),
    ...partial,
  };
}

const rowOf = (name: string) =>
  screen.getByRole("button", { name: new RegExp(name) }).closest("li") as HTMLElement;

describe("PackageContents: zonas editables (Composite)", () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
  });

  it("crea una subzona desde la fila, refresca y la anuncia", async () => {
    const createGroup = vi.fn().mockResolvedValue(
      ok({ depth: 2, groupId: "g-new", itemIds: [], name: "Mesa principal", packageVersion: 4, parentGroupId: "zona-a" }),
    );
    render(
      <PackageContents
        client={client()}
        groupsClient={groupsClient({ createGroup })}
        nodes={NESTED}
        packageId="pkg-1"
        version={3}
      />,
    );

    const row = rowOf("Zona A");
    fireEvent.click(within(row).getByRole("button", { name: "Crear subzona" }));

    const form = within(row);
    fireEvent.change(form.getByLabelText("Nombre de la zona"), { target: { value: "Mesa principal" } });
    fireEvent.click(form.getByRole("button", { name: "Crear subzona" }));

    await waitFor(() =>
      expect(createGroup).toHaveBeenCalledWith("pkg-1", {
        expectedVersion: 3,
        name: "Mesa principal",
        parentGroupId: "zona-a",
      }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("La zona Mesa principal se creó.");
  });

  it("renombra una zona conservando el resto y muestra el error de dominio", async () => {
    const updateGroup = vi
      .fn()
      .mockResolvedValueOnce(
        err({ code: "package.version_conflict", kind: "invalid", message: "El evento cambió.", status: 409 }),
      )
      .mockResolvedValueOnce(ok({ packageVersion: 4 }));
    render(
      <PackageContents
        client={client()}
        groupsClient={groupsClient({ updateGroup })}
        nodes={NESTED}
        packageId="pkg-1"
        version={3}
      />,
    );

    const row = rowOf("Zona A");
    fireEvent.click(within(row).getByRole("button", { name: "Renombrar" }));
    fireEvent.change(within(row).getByLabelText("Nuevo nombre para Zona A"), { target: { value: "Recepción" } });
    fireEvent.click(within(row).getByRole("button", { name: "Guardar nombre" }));

    expect(await within(row).findByRole("alert")).toHaveTextContent("El evento cambió.");

    fireEvent.click(within(row).getByRole("button", { name: "Guardar nombre" }));
    await waitFor(() =>
      expect(updateGroup).toHaveBeenLastCalledWith("pkg-1", "zona-a", { expectedVersion: 3, name: "Recepción" }),
    );
  });

  it("mueve una zona a otra zona con las opciones válidas", async () => {
    const updateGroup = vi.fn().mockResolvedValue(ok({ packageVersion: 4 }));
    render(
      <PackageContents
        client={client()}
        groupsClient={groupsClient({ updateGroup })}
        nodes={NESTED}
        packageId="pkg-1"
        version={3}
      />,
    );

    const row = rowOf("Zona C");
    fireEvent.click(within(row).getByRole("button", { name: "Mover" }));

    const select = within(row).getByLabelText("Mover Zona C a");
    // No puede moverse dentro de sí misma; sí bajo su hermana Zona A.
    expect(within(select).queryByRole("option", { name: /Zona C/ })).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: "zona-a" } });
    fireEvent.click(within(row).getByRole("button", { name: "Mover zona" }));

    await waitFor(() =>
      expect(updateGroup).toHaveBeenCalledWith("pkg-1", "zona-c", { expectedVersion: 3, parentGroupId: "zona-a" }),
    );
  });

  it("confirma la eliminación inline con las dos estrategias y devuelve el foco al encabezado", async () => {
    const deleteGroup = vi.fn().mockResolvedValue(ok({ packageVersion: 4 }));
    render(
      <PackageContents
        client={client()}
        groupsClient={groupsClient({ deleteGroup })}
        nodes={NESTED}
        packageId="pkg-1"
        version={3}
      />,
    );

    const row = rowOf("Zona C");
    fireEvent.click(within(row).getByRole("button", { name: "Eliminar" }));

    expect(screen.getByText("¿Eliminar Zona C?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mover contenido a la raíz y eliminar zona" })).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Eliminar zona y todo su contenido" });

    fireEvent.click(confirm);

    await waitFor(() =>
      expect(deleteGroup).toHaveBeenCalledWith("pkg-1", "zona-c", {
        expectedVersion: 3,
        strategy: "delete_contents",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Contenido del evento" })).toHaveFocus(),
    );
  });

  it("cancelar la eliminación no llama a la API", () => {
    const deleteGroup = vi.fn();
    render(
      <PackageContents
        client={client()}
        groupsClient={groupsClient({ deleteGroup })}
        nodes={NESTED}
        packageId="pkg-1"
        version={3}
      />,
    );

    const row = rowOf("Zona C");
    fireEvent.click(within(row).getByRole("button", { name: "Eliminar" }));
    fireEvent.click(within(row).getByRole("button", { name: "Cancelar" }));

    expect(deleteGroup).not.toHaveBeenCalled();
    expect(within(row).getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
  });

  it("mueve una instancia de módulo entre raíz y zonas sin perder el itemId", async () => {
    const moveItem = vi.fn().mockResolvedValue(ok({ itemId: "i-p2", packageVersion: 4 }));
    render(
      <PackageContents
        client={{ ...client(), moveItem }}
        groupsClient={groupsClient()}
        nodes={NODES}
        packageId="pkg-1"
        version={3}
      />,
    );

    const pista = screen.getByText("Pista de baile").closest("li") as HTMLElement;
    fireEvent.click(within(pista).getByRole("button", { name: "Mover de zona" }));
    fireEvent.change(within(pista).getByLabelText("Mover Pista de baile a"), { target: { value: "zona" } });
    fireEvent.click(within(pista).getByRole("button", { name: "Mover aquí" }));

    await waitFor(() =>
      expect(moveItem).toHaveBeenCalledWith("pkg-1", "i-p2", { expectedVersion: 3, groupId: "zona" }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("muestra el conflicto al mover un módulo y no refresca", async () => {
    const moveItem = vi
      .fn()
      .mockResolvedValue(err({ code: "package.version_conflict", kind: "invalid", message: "Conflicto.", status: 409 }));
    render(
      <PackageContents
        client={{ ...client(), moveItem }}
        groupsClient={groupsClient()}
        nodes={NODES}
        packageId="pkg-1"
        version={3}
      />,
    );

    const pista = screen.getByText("Pista de baile").closest("li") as HTMLElement;
    fireEvent.click(within(pista).getByRole("button", { name: "Mover de zona" }));
    fireEvent.change(within(pista).getByLabelText("Mover Pista de baile a"), { target: { value: "zona" } });
    fireEvent.click(within(pista).getByRole("button", { name: "Mover aquí" }));

    expect(await within(pista).findByRole("alert")).toHaveTextContent("Conflicto.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("no acepta una segunda mutación mientras hay un refresco pendiente", async () => {
    let resolveDelete: (value: Awaited<ReturnType<PackageGroupsClient["deleteGroup"]>>) => void = () => {};
    const deleteGroup = vi.fn(
      () => new Promise<Awaited<ReturnType<PackageGroupsClient["deleteGroup"]>>>((resolve) => (resolveDelete = resolve)),
    );
    render(
      <PackageContents
        client={client()}
        groupsClient={groupsClient({ deleteGroup })}
        nodes={NESTED}
        packageId="pkg-1"
        version={3}
      />,
    );

    const row = rowOf("Zona C");
    fireEvent.click(within(row).getByRole("button", { name: "Eliminar" }));
    fireEvent.click(within(row).getByRole("button", { name: "Mover contenido a la raíz y eliminar zona" }));

    fireEvent.click(within(row).getByRole("button", { name: "Mover contenido a la raíz y eliminar zona" }));
    expect(deleteGroup).toHaveBeenCalledTimes(1);

    resolveDelete(ok({ packageVersion: 4 }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it.each([1440, 375])("conserva la jerarquía accesible a %i px de ancho", (width) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width, writable: true });
    window.dispatchEvent(new Event("resize"));

    render(
      <PackageContents
        client={client()}
        groupsClient={groupsClient()}
        nodes={NESTED}
        packageId="pkg-1"
        version={3}
      />,
    );

    expect(screen.getByRole("heading", { name: "Contenido del evento" })).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /Zona A/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls");
  });
});
