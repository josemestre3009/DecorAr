import { describe, expect, it, vi } from "vitest";

import { createHttpPackageGroupsClient, createSimulatedPackageGroupsClient } from "./package-groups-client";

const CREATED = {
  depth: 1,
  groupId: "grp-1",
  itemIds: ["item-a", "item-m"],
  name: "Zona de bienvenida",
  packageVersion: 3,
  parentGroupId: null,
};

describe("createHttpPackageGroupsClient", () => {
  it("envía POST /api/packages/{id}/groups con children y devuelve el grupo creado", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(CREATED, { status: 201 }));

    const result = await createHttpPackageGroupsClient(fetcher).createGroup("pkg 1", {
      moduleIds: ["id-arco", "id-mesa"],
      name: "Zona de bienvenida",
    });

    expect(result).toEqual({ ok: true, value: CREATED });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/packages/pkg%201/groups");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      children: [{ moduleId: "id-arco" }, { moduleId: "id-mesa" }],
      name: "Zona de bienvenida",
      parentGroupId: null,
    });
  });

  it("traduce el envelope de error de la API", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { error: { code: "package.group_depth_exceeded", message: "Máximo 3 niveles" } },
        { status: 422 },
      ),
    );

    const result = await createHttpPackageGroupsClient(fetcher).createGroup("pkg-1", {
      moduleIds: [],
      name: "X",
      parentGroupId: "grp-3",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid");
      expect(result.error.code).toBe("package.group_depth_exceeded");
    }
  });

  it("devuelve fallo de red o de respuesta inesperada", async () => {
    const offline = await createHttpPackageGroupsClient(
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline")),
    ).createGroup("pkg-1", { moduleIds: [], name: "X" });
    expect(offline.ok).toBe(false);
    if (!offline.ok) expect(offline.error.kind).toBe("network");

    const malformed = await createHttpPackageGroupsClient(
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "x" }, { status: 201 })),
    ).createGroup("pkg-1", { moduleIds: [], name: "X" });
    expect(malformed.ok).toBe(false);
  });
});

describe("createSimulatedPackageGroupsClient", () => {
  it("responde como la API sin red", async () => {
    const result = await createSimulatedPackageGroupsClient(0).createGroup("pkg-1", {
      moduleIds: ["a", "b"],
      name: " Zona de bienvenida ",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Zona de bienvenida");
      expect(result.value.itemIds).toHaveLength(2);
      expect(result.value.depth).toBe(1);
    }
  });
});

describe("gestión de zonas (DECOR-43)", () => {
  it("renameGroup envía PATCH con el nombre y devuelve el grupo renombrado", async () => {
    const renamed = { groupId: "grp 1", name: "Sala", structureVersion: 2 };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(renamed, { status: 200 }));

    const result = await createHttpPackageGroupsClient(fetcher).renameGroup("pkg-1", "grp 1", "Sala");

    expect(result).toEqual({ ok: true, value: renamed });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/packages/pkg-1/groups/grp%201");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "Sala" });
  });

  it("renameGroup muestra el mensaje del servidor ante un nombre inválido", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { error: { code: "package.invalid_group_name", message: "El nombre debe tener entre 1 y 80 caracteres." } },
        { status: 400 },
      ),
    );

    const result = await createHttpPackageGroupsClient(fetcher).renameGroup("pkg-1", "grp-1", "");

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "package.invalid_group_name",
        kind: "invalid",
        message: "El nombre debe tener entre 1 y 80 caracteres.",
      }),
    });
  });

  it("deleteGroup envía DELETE y acepta 204 sin cuerpo", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));

    const result = await createHttpPackageGroupsClient(fetcher).deleteGroup("pkg-1", "grp-1");

    expect(result).toEqual({ ok: true, value: undefined });
    expect(fetcher.mock.calls[0][0]).toBe("/api/packages/pkg-1/groups/grp-1");
    expect(fetcher.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("deleteGroup traduce 404, 409 y fallos de red", async () => {
    const notFound = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ error: { code: "package.group_not_found", message: "No encontramos ese grupo." } }, { status: 404 }),
    );
    const conflict = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ error: { code: "package.version_conflict", message: "El paquete cambió." } }, { status: 409 }),
    );
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"));

    expect(await createHttpPackageGroupsClient(notFound).deleteGroup("p", "g")).toMatchObject({
      error: { code: "package.group_not_found", kind: "not_found" },
      ok: false,
    });
    expect(await createHttpPackageGroupsClient(conflict).deleteGroup("p", "g")).toMatchObject({
      error: { code: "package.version_conflict", kind: "invalid" },
      ok: false,
    });
    expect(await createHttpPackageGroupsClient(offline).deleteGroup("p", "g")).toMatchObject({
      error: { kind: "network" },
      ok: false,
    });
  });

  it("la simulación no finge zonas: renombrar y eliminar fallan", async () => {
    const client = createSimulatedPackageGroupsClient(0);

    expect(await client.renameGroup("p", "g", "Sala")).toMatchObject({ error: { code: "package.groups_live_only" }, ok: false });
    expect(await client.deleteGroup("p", "g")).toMatchObject({ error: { code: "package.groups_live_only" }, ok: false });
  });
});
