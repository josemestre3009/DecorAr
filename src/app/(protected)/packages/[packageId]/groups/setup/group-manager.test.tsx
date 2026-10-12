import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/shared/domain/result";

import type { GroupOption } from "../../../_lib/configurator-view";
import type { PackageGroupsClient } from "../../../_lib/package-groups-client";
import { GroupManager } from "./group-manager";

const push = vi.fn();
const refresh = vi.fn();
const router = { push, refresh };

vi.mock("next/navigation", () => ({ useRouter: () => router }));

const option = (overrides: Partial<GroupOption> & Pick<GroupOption, "groupId" | "name">): GroupOption => ({
  depth: 1,
  directGroupCount: 0,
  directLeafCount: 0,
  label: overrides.name,
  parentGroupId: null,
  parentLabel: null,
  ...overrides,
});

/** Sala (1 elemento, 1 subzona) > Mesa > Centro (nivel 3) y Entrada vacía. */
const GROUPS: GroupOption[] = [
  option({ directGroupCount: 1, directLeafCount: 1, groupId: "sala", name: "Sala" }),
  option({
    depth: 2,
    directGroupCount: 1,
    directLeafCount: 2,
    groupId: "mesa",
    label: "Sala › Mesa",
    name: "Mesa",
    parentGroupId: "sala",
    parentLabel: "Sala",
  }),
  option({
    depth: 3,
    groupId: "centro",
    label: "Sala › Mesa › Centro",
    name: "Centro",
    parentGroupId: "mesa",
    parentLabel: "Sala › Mesa",
  }),
  option({ groupId: "entrada", name: "Entrada" }),
];

function fakeClient(overrides: Partial<PackageGroupsClient> = {}): PackageGroupsClient {
  return {
    createGroup: vi.fn().mockResolvedValue(
      ok({ depth: 1, groupId: "nueva", itemIds: [], name: "Rincón", packageVersion: 1, parentGroupId: null }),
    ),
    deleteGroup: vi.fn().mockResolvedValue(ok(undefined)),
    mode: "live",
    renameGroup: vi.fn().mockResolvedValue(ok({ groupId: "sala", name: "Sala principal", structureVersion: 2 })),
    ...overrides,
  };
}

const status = () => screen.getAllByRole("status")[0];

describe("GroupManager (DECOR-43)", () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
  });

  it("sin zonas explica el paso opcional y ofrece omitirlo hacia el configurador", () => {
    render(<GroupManager client={fakeClient()} groups={[]} packageId="pkg 1" />);

    expect(screen.getByText(/Todavía no tienes zonas/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Omitir por ahora" })).toHaveAttribute("href", "/packages/pkg%201");
    expect(screen.queryByRole("link", { name: "Continuar al catálogo" })).not.toBeInTheDocument();
  });

  it("con zonas lista cada una con su ubicación y contenido, y ofrece continuar al catálogo", () => {
    render(<GroupManager client={fakeClient()} groups={GROUPS} packageId="pkg-1" />);

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText("1 elemento y 1 subzona")).toBeInTheDocument();
    expect(within(rows[1]).getByText("en Sala")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Vacía")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continuar al catálogo" })).toHaveAttribute("href", "/packages/pkg-1");
  });

  it("crea una zona vacía en el nivel principal o dentro de otra, sin ofrecer zonas de nivel 3 como padre", async () => {
    const client = fakeClient();
    render(<GroupManager client={client} groups={GROUPS} packageId="pkg-1" />);

    const parent = screen.getByLabelText("Ubicación");
    expect(within(parent).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Nivel principal",
      "Dentro de Sala",
      "Dentro de Sala › Mesa",
      "Dentro de Entrada",
    ]);

    fireEvent.change(screen.getByLabelText("Nombre de la zona"), { target: { value: "Rincón" } });
    fireEvent.change(parent, { target: { value: "mesa" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear zona" }));

    await waitFor(() =>
      expect(client.createGroup).toHaveBeenCalledWith("pkg-1", { moduleIds: [], name: "Rincón", parentGroupId: "mesa" }),
    );
    expect(await screen.findByText("Zona «Rincón» creada.")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre de la zona")).toHaveValue("");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("muestra junto al campo el error del servidor al crear y no refresca", async () => {
    const client = fakeClient({
      createGroup: vi.fn().mockResolvedValue(
        err({ code: "package.invalid_group_name", kind: "invalid", message: "El nombre debe tener entre 1 y 80 caracteres." }),
      ),
    });
    render(<GroupManager client={client} groups={[]} packageId="pkg-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Crear zona" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("El nombre debe tener entre 1 y 80 caracteres.");
    expect(screen.getByLabelText("Nombre de la zona")).toHaveAttribute("aria-invalid", "true");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("no envía dos veces la misma creación con clics repetidos", async () => {
    let resolveCreate: (value: Awaited<ReturnType<PackageGroupsClient["createGroup"]>>) => void = () => {};
    const client = fakeClient({
      createGroup: vi.fn(
        () => new Promise<Awaited<ReturnType<PackageGroupsClient["createGroup"]>>>((resolve) => (resolveCreate = resolve)),
      ),
    });
    render(<GroupManager client={client} groups={[]} packageId="pkg-1" />);

    fireEvent.change(screen.getByLabelText("Nombre de la zona"), { target: { value: "Sala" } });
    const submit = screen.getByRole("button", { name: "Crear zona" });
    fireEvent.click(submit);
    fireEvent.click(screen.getByRole("button", { name: "Creando zona…" }));

    expect(screen.getByRole("button", { name: "Creando zona…" })).toHaveAttribute("aria-busy", "true");
    expect(client.createGroup).toHaveBeenCalledTimes(1);

    resolveCreate(ok({ depth: 1, groupId: "g", itemIds: [], name: "Sala", packageVersion: 1, parentGroupId: null }));
    await screen.findByText("Zona «Sala» creada.");
  });

  it("renombra una zona con el nombre escrito y vuelve el foco a su botón", async () => {
    const client = fakeClient();
    render(<GroupManager client={client} groups={GROUPS} packageId="pkg-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Renombrar Sala" }));
    const input = screen.getByLabelText("Nuevo nombre para «Sala»");
    expect(input).toHaveValue("Sala");
    fireEvent.change(input, { target: { value: "Sala principal" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(client.renameGroup).toHaveBeenCalledWith("pkg-1", "sala", "Sala principal"));
    expect(await screen.findByText("Zona renombrada a «Sala principal».")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "Renombrar Sala" })).toHaveFocus());
  });

  it("un nombre inválido muestra el error y conserva el nombre anterior en la lista", async () => {
    const client = fakeClient({
      renameGroup: vi.fn().mockResolvedValue(
        err({ code: "package.invalid_group_name", kind: "invalid", message: "El nombre debe tener entre 1 y 80 caracteres." }),
      ),
    });
    render(<GroupManager client={client} groups={GROUPS} packageId="pkg-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Renombrar Sala" }));
    fireEvent.change(screen.getByLabelText("Nuevo nombre para «Sala»"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("El nombre debe tener entre 1 y 80 caracteres.");
    expect(screen.getByLabelText("Nuevo nombre para «Sala»")).toHaveAttribute("aria-invalid", "true");
    expect(refresh).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByText("Sala", { selector: ".content-name" })).toBeInTheDocument();
  });

  it("Escape cancela el renombrado sin llamar al servidor", () => {
    const client = fakeClient();
    render(<GroupManager client={client} groups={GROUPS} packageId="pkg-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Renombrar Entrada" }));
    fireEvent.keyDown(screen.getByLabelText("Nuevo nombre para «Entrada»"), { key: "Escape" });

    expect(screen.queryByLabelText("Nuevo nombre para «Entrada»")).not.toBeInTheDocument();
    expect(client.renameGroup).not.toHaveBeenCalled();
  });

  it("pide confirmar antes de eliminar y explica a dónde pasa el contenido", async () => {
    const client = fakeClient();
    render(<GroupManager client={client} groups={GROUPS} packageId="pkg-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Eliminar Sala › Mesa" }));

    expect(client.deleteGroup).not.toHaveBeenCalled();
    const confirm = screen.getByRole("group", { name: /¿Eliminar «Mesa»\?/ });
    expect(confirm).toHaveTextContent("Su contenido (2 elementos y 1 subzona) pasará a Sala. No se borra ningún elemento.");

    fireEvent.click(within(confirm).getByRole("button", { name: "Sí, eliminar zona" }));

    await waitFor(() => expect(client.deleteGroup).toHaveBeenCalledWith("pkg-1", "mesa"));
    expect(await screen.findByText("Se eliminó «Mesa». Su contenido pasó a Sala.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Tus zonas" })).toHaveFocus());
  });

  it("al eliminar una zona raíz el contenido pasa al nivel principal", async () => {
    render(<GroupManager client={fakeClient()} groups={GROUPS} packageId="pkg-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Eliminar Sala" }));
    expect(screen.getByRole("group", { name: /¿Eliminar «Sala»\?/ })).toHaveTextContent(
      "Su contenido (1 elemento y 1 subzona) pasará al nivel principal.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Sí, eliminar zona" }));

    expect(await screen.findByText("Se eliminó «Sala». Su contenido pasó al nivel principal.")).toBeInTheDocument();
  });

  it("cancelar la confirmación no elimina nada", () => {
    const client = fakeClient();
    render(<GroupManager client={client} groups={GROUPS} packageId="pkg-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Eliminar Entrada" }));
    expect(screen.getByRole("group", { name: /¿Eliminar «Entrada»\?/ })).toHaveTextContent("La zona está vacía.");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("group", { name: /¿Eliminar/ })).not.toBeInTheDocument();
    expect(client.deleteGroup).not.toHaveBeenCalled();
  });

  it("si el servidor rechaza la eliminación, lo muestra en la confirmación y no refresca", async () => {
    const client = fakeClient({
      deleteGroup: vi.fn().mockResolvedValue(
        err({ code: "package.version_conflict", kind: "invalid", message: "El paquete cambió mientras guardabas." }),
      ),
    });
    render(<GroupManager client={client} groups={GROUPS} packageId="pkg-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Eliminar Sala" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, eliminar zona" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("El paquete cambió mientras guardabas.");
    expect(screen.getByRole("group", { name: /¿Eliminar «Sala»\?/ })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(status()).toHaveTextContent("");
  });

  it("vuelve al login si la sesión terminó", async () => {
    const client = fakeClient({
      deleteGroup: vi.fn().mockResolvedValue(err({ kind: "unauthorized", message: "Sesión terminada", status: 401 })),
    });
    render(<GroupManager client={client} groups={GROUPS} packageId="pkg-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Eliminar Entrada" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, eliminar zona" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });
});
