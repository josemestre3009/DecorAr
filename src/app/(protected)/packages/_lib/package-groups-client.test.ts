import { describe, expect, it, vi } from "vitest";

import {
  createHttpPackageGroupsClient,
  createSimulatedPackageGroupsClient,
} from "./package-groups-client";

const CREATED = {
  depth: 1,
  groupId: "grp-1",
  itemIds: ["item-a", "item-m"],
  name: "Zona de bienvenida",
  packageVersion: 3,
  parentGroupId: null,
};

describe("createHttpPackageGroupsClient", () => {
  it("envía POST /groups con children, padre y expectedVersion y devuelve el grupo creado", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(CREATED, { status: 201 }));

    const result = await createHttpPackageGroupsClient(fetcher).createGroup("pkg 1", {
      expectedVersion: 3,
      moduleIds: ["id-arco", "id-mesa"],
      name: "Zona de bienvenida",
      parentGroupId: null,
    });

    expect(result).toEqual({ ok: true, value: CREATED });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/packages/pkg%201/groups");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      children: [{ moduleId: "id-arco" }, { moduleId: "id-mesa" }],
      expectedVersion: 3,
      name: "Zona de bienvenida",
      parentGroupId: null,
    });
  });

  it("crear una zona vacía no manda children", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...CREATED, itemIds: [] }, { status: 201 }));

    const result = await createHttpPackageGroupsClient(fetcher).createGroup("pkg-1", { name: "Recepción" });

    expect(result.ok).toBe(true);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      children: [],
      name: "Recepción",
      parentGroupId: null,
    });
  });

  it("PATCH /groups/{id} renombra con expectedVersion", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ packageVersion: 4 }, { status: 200 }));

    const result = await createHttpPackageGroupsClient(fetcher).updateGroup("pkg 1", "grp/2", {
      expectedVersion: 3,
      name: "Recepción",
    });

    expect(result).toEqual({ ok: true, value: { packageVersion: 4 } });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/packages/pkg%201/groups/grp%2F2");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ expectedVersion: 3, name: "Recepción" });
  });

  it("PATCH /groups/{id} mueve a la raíz con parentGroupId null", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ packageVersion: 5 }, { status: 200 }));

    await createHttpPackageGroupsClient(fetcher).updateGroup("p1", "g1", { expectedVersion: 4, parentGroupId: null });

    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ expectedVersion: 4, parentGroupId: null });
  });

  it("DELETE /groups/{id} envía strategy y expectedVersion", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ packageVersion: 6 }, { status: 200 }));

    const result = await createHttpPackageGroupsClient(fetcher).deleteGroup("p1", "g1", {
      expectedVersion: 5,
      strategy: "delete_contents",
    });

    expect(result).toEqual({ ok: true, value: { packageVersion: 6 } });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/packages/p1/groups/g1");
    expect(init?.method).toBe("DELETE");
    expect(JSON.parse(String(init?.body))).toEqual({ expectedVersion: 5, strategy: "delete_contents" });
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

  it.each([
    [409, "package.version_conflict", "invalid"],
    [404, "package.group_not_found", "not_found"],
  ])("al eliminar, un %i se traduce con el envelope (%s)", async (status, code, kind) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: { code, message: "mensaje" } }, { status }));

    const result = await createHttpPackageGroupsClient(fetcher).deleteGroup("p1", "g1", { strategy: "move_to_root" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe(kind);
      expect(result.error.code).toBe(code);
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

    const badMutation = await createHttpPackageGroupsClient(
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }, { status: 200 })),
    ).updateGroup("p1", "g1", { name: "Y" });
    expect(badMutation.ok).toBe(false);
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

  it("rechaza un nombre vacío o demasiado largo", async () => {
    const client = createSimulatedPackageGroupsClient(0);

    const empty = await client.createGroup("pkg-1", { name: "   " });
    expect(!empty.ok && empty.error.code).toBe("package.invalid_group_name");

    const long = await client.createGroup("pkg-1", { name: "x".repeat(81) });
    expect(!long.ok && long.error.code).toBe("package.invalid_group_name");
  });

  it("renombra y elimina zonas existentes subiendo la versión", async () => {
    const client = createSimulatedPackageGroupsClient(0);
    const created = await client.createGroup("pkg-1", { name: "Zona", expectedVersion: 1 });
    if (!created.ok) throw new Error("no se creó la zona");

    const renamed = await client.updateGroup("pkg-1", created.value.groupId, { expectedVersion: 1, name: "Zona A" });
    expect(renamed).toEqual({ ok: true, value: { packageVersion: 2 } });

    const unknown = await client.updateGroup("pkg-1", "desconocida", { name: "X" });
    expect(!unknown.ok && unknown.error.code).toBe("package.group_not_found");

    const deleted = await client.deleteGroup("pkg-1", created.value.groupId, {
      expectedVersion: 2,
      strategy: "delete_contents",
    });
    expect(deleted).toEqual({ ok: true, value: { packageVersion: 3 } });
  });
});
