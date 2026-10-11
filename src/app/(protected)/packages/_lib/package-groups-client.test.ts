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
