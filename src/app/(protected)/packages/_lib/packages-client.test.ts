import { describe, expect, it, vi } from "vitest";

import {
  createHttpPackagesClient,
  createSimulatedPackagesClient,
  resolvePackagesMode,
  SIMULATED_STORAGE_KEY,
} from "./packages-client";

function memoryStorage() {
  const data = new Map<string, string>();

  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

describe("createHttpPackagesClient (contrato de DECOR-44)", () => {
  const CREATED = {
    capacityM2: 30,
    clientName: null,
    eventDate: null,
    eventType: null,
    id: "p1",
    name: "Boda de Ana",
    spaceType: "casa" as const,
    spatial: { availableM2: 30, requiredM2: 0, status: "compatible" as const },
    venue: null,
  };

  it("crea el evento con POST /api/packages {name, ...metadata}", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(CREATED, { status: 201 }));
    const client = createHttpPackagesClient(fetcher);

    const result = await client.createPackage({ capacityM2: 30, name: "Boda de Ana", spaceType: "casa" });

    expect(result).toEqual({ ok: true, value: CREATED });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/packages");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ capacityM2: 30, name: "Boda de Ana", spaceType: "casa" });
  });

  it("crea el evento solo con nombre (sin metadatos)", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ ...CREATED, capacityM2: null, spaceType: null, spatial: { availableM2: null, requiredM2: 0, status: "pending" } }, { status: 201 }),
      );

    const result = await createHttpPackagesClient(fetcher).createPackage({ name: "Solo nombre" });

    expect(result.ok).toBe(true);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ name: "Solo nombre" });
  });

  it("actualiza metadatos con PATCH /api/packages/{id}", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(CREATED, { status: 200 }));
    const client = createHttpPackagesClient(fetcher);

    const result = await client.updateMetadata("p 1", { capacityM2: null, name: "Boda" });

    expect(result).toEqual({ ok: true, value: CREATED });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/packages/p%201");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ capacityM2: null, name: "Boda" });
  });

  it("agrega un módulo con POST /api/packages/{id}/items {moduleId}", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ itemId: "i1", packageVersion: 2 }, { status: 201 }));
    const client = createHttpPackagesClient(fetcher);

    const result = await client.addItem("p 1", "m1");

    expect(result).toEqual({ ok: true, value: { itemId: "i1", packageVersion: 2 } });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/packages/p%201/items");
    expect(JSON.parse(String(init?.body))).toEqual({ moduleId: "m1" });
  });

  it("envía quantity al agregar varias unidades", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ itemId: "i1", itemIds: ["i1", "i2"], packageVersion: 3 }, { status: 201 }),
    );

    const result = await createHttpPackagesClient(fetcher).addItem("p1", "m1", 2);

    expect(result).toEqual({
      ok: true,
      value: { itemId: "i1", itemIds: ["i1", "i2"], packageVersion: 3 },
    });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ moduleId: "m1", quantity: 2 });
  });

  it("clona un paquete con POST /api/packages/{id}/clone", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          capacityM2: 50,
          colors: ["#fff"],
          id: "p-cloned",
          itemCount: 2,
          notes: "Nota",
          spaceType: "salonSocial",
          style: "bohemio",
          version: 1,
        },
        { status: 201 },
      ),
    );
    const client = createHttpPackagesClient(fetcher);

    const result = await client.clonePackage("p 1");

    expect(result).toEqual({
      ok: true,
      value: {
        capacityM2: 50,
        colors: ["#fff"],
        id: "p-cloned",
        itemCount: 2,
        notes: "Nota",
        spaceType: "salonSocial",
        style: "bohemio",
        version: 1,
      },
    });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/packages/p%201/clone");
    expect(init?.method).toBe("POST");
  });

  it("devuelve el mensaje del envelope en un 422", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { error: { code: "package.capacity_exceeded", message: "Excede la capacidad." } },
        { status: 422 },
      ),
    );

    const result = await createHttpPackagesClient(fetcher).addItem("p1", "m1");

    expect(result).toEqual({
      ok: false,
      error: {
        code: "package.capacity_exceeded",
        kind: "invalid",
        message: "Excede la capacidad.",
        status: 422,
      },
    });
  });

  it("marca el 401 para volver a iniciar sesión", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: "unauthorized" }, { status: 401 }));

    const result = await createHttpPackagesClient(fetcher).createPackage({
      name: "X",
      spaceType: "casa",
      capacityM2: 30,
    });

    expect(!result.ok && result.error.kind).toBe("unauthorized");
  });

  it("rechaza un 201 con un cuerpo distinto al contrato", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ packageId: "p1" }, { status: 201 }));

    const result = await createHttpPackagesClient(fetcher).createPackage({
      name: "X",
      spaceType: "casa",
      capacityM2: 30,
    });

    expect(!result.ok && result.error.kind).toBe("server");
  });

  it("informa la falta de conexión", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await createHttpPackagesClient(fetcher).addItem("p1", "m1");

    expect(!result.ok && result.error.kind).toBe("network");
  });

  it("quita un elemento con DELETE /api/packages/{id}/items/{itemId} y acepta 204 sin cuerpo (DECOR-22)", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));

    const result = await createHttpPackagesClient(fetcher).removeItem("p 1", "i/1");

    expect(result).toEqual({ ok: true, value: undefined });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/packages/p%201/items/i%2F1");
    expect(init?.method).toBe("DELETE");
  });

  it.each([
    [404, "package.item_not_found", "not_found"],
    [409, "package.version_conflict", "invalid"],
  ])("al quitar, un %i se traduce con el envelope (%s)", async (status, code, kind) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: { code, message: "mensaje" } }, { status }));

    const result = await createHttpPackagesClient(fetcher).removeItem("p1", "i1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(code);
      expect(result.error.kind).toBe(kind);
    }
  });

  it("al quitar, un 200 inesperado o un fallo de red son errores", async () => {
    const unexpected = await createHttpPackagesClient(
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status: 200 })),
    ).removeItem("p1", "i1");
    expect(unexpected.ok).toBe(false);

    const offline = await createHttpPackagesClient(
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline")),
    ).removeItem("p1", "i1");
    expect(!offline.ok && offline.error.kind).toBe("network");
  });

  it("mueve un elemento con PATCH /api/packages/{id}/items/{itemId} {groupId, expectedVersion}", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ itemId: "i1", packageVersion: 5 }, { status: 200 }));

    const result = await createHttpPackagesClient(fetcher).moveItem("p 1", "i/1", {
      expectedVersion: 4,
      groupId: "g-1",
    });

    expect(result).toEqual({ ok: true, value: { itemId: "i1", packageVersion: 5 } });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/packages/p%201/items/i%2F1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ expectedVersion: 4, groupId: "g-1" });
  });

  it("mover a la raíz envía groupId null sin expectedVersion", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ itemId: "i1", packageVersion: 5 }, { status: 200 }));

    await createHttpPackagesClient(fetcher).moveItem("p1", "i1", { groupId: null });

    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ groupId: null });
  });

  it("al mover, un 409 se traduce con el envelope", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ error: { code: "package.version_conflict", message: "Conflicto." } }, { status: 409 }),
      );

    const result = await createHttpPackagesClient(fetcher).moveItem("p1", "i1", { groupId: "g-1" });

    expect(!result.ok && result.error.code).toBe("package.version_conflict");
    expect(!result.ok && result.error.kind).toBe("invalid");
  });
});

describe("createSimulatedPackagesClient", () => {
  it("quita un elemento, sube la versión y responde 404 si no existe", async () => {
    const client = createSimulatedPackagesClient(memoryStorage(), 0);
    const created = await client.createPackage({ name: "Evento", spaceType: "casa", capacityM2: 30 });
    if (!created.ok) throw new Error("no se creó el paquete");
    const added = await client.addItem(created.value.id, "mesa");
    if (!added.ok) throw new Error("no se agregó");

    expect(await client.removeItem(created.value.id, added.value.itemId)).toEqual({ ok: true, value: undefined });

    const again = await client.removeItem(created.value.id, added.value.itemId);
    expect(!again.ok && again.error.code).toBe("package.item_not_found");

    const unknown = await client.removeItem("desconocido", "x");
    expect(!unknown.ok && unknown.error.code).toBe("package.not_found");
  });

  it("mueve un elemento entre zonas, sube la versión y detecta el conflicto y el 404", async () => {
    const client = createSimulatedPackagesClient(memoryStorage(), 0);
    const created = await client.createPackage({ name: "Evento", spaceType: "casa", capacityM2: 30 });
    if (!created.ok) throw new Error("no se creó el paquete");
    const added = await client.addItem(created.value.id, "mesa");
    if (!added.ok) throw new Error("no se agregó");

    const moved = await client.moveItem(created.value.id, added.value.itemId, {
      expectedVersion: added.value.packageVersion,
      groupId: "g-2",
    });
    expect(moved).toEqual({
      ok: true,
      value: { itemId: added.value.itemId, packageVersion: added.value.packageVersion + 1 },
    });

    const conflict = await client.moveItem(created.value.id, added.value.itemId, { expectedVersion: 1, groupId: "g-3" });
    expect(!conflict.ok && conflict.error.code).toBe("package.version_conflict");

    const missing = await client.moveItem(created.value.id, "nope", { groupId: "g-2" });
    expect(!missing.ok && missing.error.code).toBe("package.item_not_found");
  });

  it("responde con la misma forma que el contrato y guarda en sessionStorage", async () => {
    const storage = memoryStorage();
    const client = createSimulatedPackagesClient(storage, 0);

    const created = await client.createPackage({ name: "Evento", spaceType: "salonSocial", capacityM2: 45.5 });

    expect(client.mode).toBe("simulated");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value).toMatchObject({
      capacityM2: 45.5,
      name: "Evento",
      spaceType: "salonSocial",
      spatial: { availableM2: 45.5, requiredM2: 0, status: "compatible" },
    });
    expect(storage.data.get(SIMULATED_STORAGE_KEY)).toContain(created.value.id);
  });

  it("crea un evento solo con nombre y deja el diagnóstico pendiente", async () => {
    const created = await createSimulatedPackagesClient(memoryStorage(), 0).createPackage({ name: "Solo nombre" });

    expect(created.ok && created.value).toMatchObject({
      capacityM2: null,
      name: "Solo nombre",
      spaceType: null,
      spatial: { availableM2: null, status: "pending" },
    });
  });

  it("rechaza un nombre vacío en modo simulado", async () => {
    const result = await createSimulatedPackagesClient(memoryStorage(), 0).createPackage({ name: "   " });

    expect(!result.ok && result.error.code).toBe("package.invalid_name");
  });

  it("actualiza metadatos y recalcula el diagnóstico (PATCH simulado)", async () => {
    const client = createSimulatedPackagesClient(memoryStorage(), 0);
    const created = await client.createPackage({ name: "Evento" });
    if (!created.ok) throw new Error("no se creó");

    const updated = await client.updateMetadata(created.value.id, { capacityM2: 25, clientName: "Ana" });

    expect(updated.ok && updated.value).toMatchObject({
      capacityM2: 25,
      clientName: "Ana",
      spatial: { availableM2: 25, status: "compatible" },
    });

    const cleared = await client.updateMetadata(created.value.id, { capacityM2: null });
    expect(cleared.ok && cleared.value.spatial.status).toBe("pending");
  });

  it("incrementa la versión del paquete con cada módulo agregado", async () => {
    const client = createSimulatedPackagesClient(memoryStorage(), 0);
    const created = await client.createPackage({ name: "Evento", spaceType: "casa", capacityM2: 30 });
    if (!created.ok) throw new Error("no se creó el paquete");

    const first = await client.addItem(created.value.id, "mesa");
    const second = await client.addItem(created.value.id, "mesa");

    expect(first.ok && first.value.packageVersion).toBe(2);
    expect(second.ok && second.value.packageVersion).toBe(3);
  });

  it("conserva el paquete al recargar con el mismo almacenamiento", async () => {
    const storage = memoryStorage();
    const created = await createSimulatedPackagesClient(storage, 0).createPackage({
      name: "Evento",
      spaceType: "aireLibre",
      capacityM2: 80,
    });
    if (!created.ok) throw new Error("no se creó el paquete");

    const afterReload = createSimulatedPackagesClient(storage, 0);

    await expect(afterReload.addItem(created.value.id, "arco")).resolves.toMatchObject({
      ok: true,
    });
  });

  it("clona un paquete existente con nuevo id y version 1 en modo simulado", async () => {
    const storage = memoryStorage();
    const client = createSimulatedPackagesClient(storage, 0);
    const created = await client.createPackage({ name: "Evento", spaceType: "salonSocial", capacityM2: 50 });
    if (!created.ok) throw new Error("no se creó el paquete");

    await client.addItem(created.value.id, "arco");

    const cloned = await client.clonePackage(created.value.id);
    expect(cloned.ok).toBe(true);
    if (cloned.ok) {
      expect(cloned.value.id).not.toBe(created.value.id);
      expect(cloned.value.spaceType).toBe("salonSocial");
      expect(cloned.value.capacityM2).toBe(50);
      expect(cloned.value.itemCount).toBe(1);
      expect(cloned.value.version).toBe(1);
    }
  });

  it("responde 404 para un paquete desconocido al clonar en modo simulado", async () => {
    const result = await createSimulatedPackagesClient(memoryStorage(), 0).clonePackage("desconocido");

    expect(!result.ok && result.error).toMatchObject({
      code: "package.not_found",
      kind: "not_found",
      status: 404,
    });
  });

  it("responde 404 para un paquete desconocido", async () => {
    const result = await createSimulatedPackagesClient(memoryStorage(), 0).addItem("x", "mesa");

    expect(!result.ok && result.error).toMatchObject({
      code: "package.not_found",
      kind: "not_found",
      status: 404,
    });
  });

  it("responde 422 para una capacidad inválida, como el servidor", async () => {
    const result = await createSimulatedPackagesClient(memoryStorage(), 0).createPackage({ name: "Evento", spaceType: "casa", capacityM2: Number.POSITIVE_INFINITY });

    expect(!result.ok && result.error).toMatchObject({
      code: "package.invalid_capacity",
      status: 422,
    });
  });

  it("sigue funcionando sin almacenamiento del navegador", async () => {
    const client = createSimulatedPackagesClient(null, 0);
    const created = await client.createPackage({ name: "Evento", spaceType: "casa", capacityM2: 30 });
    if (!created.ok) throw new Error("no se creó el paquete");

    await expect(client.addItem(created.value.id, "mesa")).resolves.toMatchObject({ ok: true });
  });

  it("usa memoria si el navegador bloquea sessionStorage", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get: () => {
        throw new DOMException("Access denied", "SecurityError");
      },
    });

    try {
      const client = createSimulatedPackagesClient(undefined, 0);
      await expect(
        client.createPackage({ name: "Evento", spaceType: "casa", capacityM2: 30 }),
      ).resolves.toMatchObject({ ok: true });
    } finally {
      if (descriptor) Object.defineProperty(window, "sessionStorage", descriptor);
    }
  });
});

describe("resolvePackagesMode", () => {
  it.each([
    ["live", "live"],
    ["simulated", "simulated"],
    [undefined, "simulated"],
    ["LIVE", "simulated"],
  ])("%j → %s", (value, expected) => {
    expect(resolvePackagesMode(value)).toBe(expected);
  });
});
