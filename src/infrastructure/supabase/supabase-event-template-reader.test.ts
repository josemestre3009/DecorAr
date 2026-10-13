import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SupabaseEventTemplateReader } from "./supabase-event-template-reader";

type QueryResult = { data: unknown; error: unknown };

function fakeClient(result: QueryResult) {
  const filters: [string, unknown][] = [];
  const chain = {
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return chain;
    },
    maybeSingle: () => Promise.resolve(result),
    order: () => Promise.resolve(result),
    select: () => chain,
  };
  const from = vi.fn(() => chain);
  return { client: { from } as unknown as SupabaseClient, filters, from };
}

const ROW = {
  capacity_m2: "80.00",
  colors: ["#fff", "#000"],
  event_type: "boda",
  id: "tpl-1",
  name: "Boda base",
  notes: "Notas",
  space_type: "salonSocial",
  style: "elegante",
  updated_at: "2026-10-12T15:00:00Z",
};

describe("SupabaseEventTemplateReader", () => {
  it("listByOwner filtra por dueño y mapea la fila completa", async () => {
    const { client, filters, from } = fakeClient({ data: [ROW], error: null });

    const result = await new SupabaseEventTemplateReader(client).listByOwner("user-1");

    expect(from).toHaveBeenCalledWith("event_templates");
    expect(filters).toEqual([["owner_id", "user-1"]]);
    expect(result).toEqual({
      ok: true,
      value: [
        {
          capacityM2: 80,
          colors: ["#fff", "#000"],
          eventType: "boda",
          id: "tpl-1",
          name: "Boda base",
          notes: "Notas",
          spaceType: "salonSocial",
          style: "elegante",
          updatedAt: "2026-10-12T15:00:00Z",
        },
      ],
    });
  });

  it("listByOwner tolera campos ausentes y colores no textuales", async () => {
    const { client } = fakeClient({
      data: [{ colors: ["#fff", 7, null], id: "tpl-2", name: null, updated_at: "2026-10-12T15:00:00Z" }],
      error: null,
    });

    const result = await new SupabaseEventTemplateReader(client).listByOwner("user-1");

    expect(result.ok && result.value[0]).toEqual({
      capacityM2: null,
      colors: ["#fff"],
      eventType: null,
      id: "tpl-2",
      name: "",
      notes: "",
      spaceType: null,
      style: null,
      updatedAt: "2026-10-12T15:00:00Z",
    });
  });

  it("getTemplate filtra por id y dueño", async () => {
    const { client, filters } = fakeClient({ data: ROW, error: null });

    const result = await new SupabaseEventTemplateReader(client).getTemplate("tpl-1", "user-1");

    expect(filters).toEqual([
      ["id", "tpl-1"],
      ["owner_id", "user-1"],
    ]);
    expect(result.ok && result.value?.id).toBe("tpl-1");
  });

  it("getTemplate devuelve null cuando no existe o el id está mal formado", async () => {
    const missing = fakeClient({ data: null, error: null });
    expect(await new SupabaseEventTemplateReader(missing.client).getTemplate("tpl-x", "user-1")).toEqual({
      ok: true,
      value: null,
    });

    const malformed = fakeClient({ data: null, error: { code: "22P02", message: "invalid uuid" } });
    expect(await new SupabaseEventTemplateReader(malformed.client).getTemplate("no-uuid", "user-1")).toEqual({
      ok: true,
      value: null,
    });
  });

  it("convierte errores y excepciones en template.persistence_error", async () => {
    const failing = fakeClient({ data: null, error: { code: "XX000", message: "boom" } });
    const errored = await new SupabaseEventTemplateReader(failing.client).listByOwner("user-1");
    expect(!errored.ok && errored.error.code).toBe("template.persistence_error");

    const throwing = {
      from: () => {
        throw new Error("network down");
      },
    } as unknown as SupabaseClient;
    const thrown = await new SupabaseEventTemplateReader(throwing).getTemplate("tpl-1", "user-1");
    expect(!thrown.ok && thrown.error.code).toBe("template.persistence_error");
  });
});
