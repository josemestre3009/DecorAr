import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { fetchCatalogModules } from "./catalog-client";

const fixture: unknown = JSON.parse(
  readFileSync(resolve("public/fixtures/catalog-modules.json"), "utf8"),
);

describe("fetchCatalogModules", () => {
  it("consulta GET /api/modules y devuelve el fixture de DECOR-28", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));

    const result = await fetchCatalogModules(fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/modules", expect.anything());
    expect(result).toEqual({ ok: true, value: fixture });
  });

  it("devuelve una lista vacía sin tratarla como error", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json([]));

    await expect(fetchCatalogModules(fetcher)).resolves.toEqual({ ok: true, value: [] });
  });

  it("acepta un módulo sin imagen", async () => {
    const [first] = fixture as Record<string, unknown>[];
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json([{ ...first, posterUrl: null }]));

    const result = await fetchCatalogModules(fetcher);

    expect(result.ok).toBe(true);
  });

  it("traduce un 500 en un error de servidor", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ error: "Internal Server Error", correlationId: "abc" }, { status: 500 }),
      );

    const result = await fetchCatalogModules(fetcher);

    expect(!result.ok && result.error.kind).toBe("server");
  });

  it("trata una respuesta con otra forma como inesperada", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ modules: [] }));

    const result = await fetchCatalogModules(fetcher);

    expect(!result.ok && result.error.kind).toBe("server");
  });

  it("rechaza un módulo con precio ausente", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json([{ id: "1", name: "Mesa", areaM2: 4, posterUrl: null }]));

    const result = await fetchCatalogModules(fetcher);

    expect(result.ok).toBe(false);
  });

  it("informa la falta de conexión", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await fetchCatalogModules(fetcher);

    expect(!result.ok && result.error.kind).toBe("network");
  });
});
