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

describe("createHttpPackagesClient (contrato de DECOR-27)", () => {
  it("crea el paquete con POST /api/packages {spaceType, capacityM2}", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ id: "p1", spaceType: "casa", capacityM2: 30 }, { status: 201 }),
      );
    const client = createHttpPackagesClient(fetcher);

    const result = await client.createPackage({ spaceType: "casa", capacityM2: 30 });

    expect(result).toEqual({ ok: true, value: { id: "p1", spaceType: "casa", capacityM2: 30 } });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/packages");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ capacityM2: 30, spaceType: "casa" });
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
});

describe("createSimulatedPackagesClient", () => {
  it("responde con la misma forma que el contrato y guarda en sessionStorage", async () => {
    const storage = memoryStorage();
    const client = createSimulatedPackagesClient(storage, 0);

    const created = await client.createPackage({ spaceType: "salonSocial", capacityM2: 45.5 });

    expect(client.mode).toBe("simulated");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value).toEqual({
      id: expect.any(String),
      spaceType: "salonSocial",
      capacityM2: 45.5,
    });
    expect(storage.data.get(SIMULATED_STORAGE_KEY)).toContain(created.value.id);
  });

  it("incrementa la versión del paquete con cada módulo agregado", async () => {
    const client = createSimulatedPackagesClient(memoryStorage(), 0);
    const created = await client.createPackage({ spaceType: "casa", capacityM2: 30 });
    if (!created.ok) throw new Error("no se creó el paquete");

    const first = await client.addItem(created.value.id, "mesa");
    const second = await client.addItem(created.value.id, "mesa");

    expect(first.ok && first.value.packageVersion).toBe(2);
    expect(second.ok && second.value.packageVersion).toBe(3);
  });

  it("conserva el paquete al recargar con el mismo almacenamiento", async () => {
    const storage = memoryStorage();
    const created = await createSimulatedPackagesClient(storage, 0).createPackage({
      spaceType: "aireLibre",
      capacityM2: 80,
    });
    if (!created.ok) throw new Error("no se creó el paquete");

    const afterReload = createSimulatedPackagesClient(storage, 0);

    await expect(afterReload.addItem(created.value.id, "arco")).resolves.toMatchObject({
      ok: true,
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
    const result = await createSimulatedPackagesClient(memoryStorage(), 0).createPackage({
      spaceType: "casa",
      capacityM2: Number.POSITIVE_INFINITY,
    });

    expect(!result.ok && result.error).toMatchObject({
      code: "package.invalid_capacity",
      status: 422,
    });
  });

  it("sigue funcionando sin almacenamiento del navegador", async () => {
    const client = createSimulatedPackagesClient(null, 0);
    const created = await client.createPackage({ spaceType: "casa", capacityM2: 30 });
    if (!created.ok) throw new Error("no se creó el paquete");

    await expect(client.addItem(created.value.id, "mesa")).resolves.toMatchObject({ ok: true });
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
