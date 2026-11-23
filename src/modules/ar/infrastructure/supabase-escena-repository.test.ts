import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SupabaseEscenaRepository } from "./supabase-escena-repository";

const clientWithRpc = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as SupabaseClient;

const command = {
  expectedSceneVersion: 2,
  packageId: "pkg-1",
  transformaciones: [{ itemId: "item-1", posicion: { x: 1, y: 0, z: 1 }, rotacionDeg: 45 }],
  userId: "user-1",
};

describe("SupabaseEscenaRepository.guardar", () => {
  it("invoca save_package_scene con todos los parámetros y devuelve la versión", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 3, error: null });

    const result = await new SupabaseEscenaRepository(clientWithRpc(rpc)).guardar(command);

    expect(rpc).toHaveBeenCalledWith("save_package_scene", {
      p_expected_version: 2,
      p_package_id: "pkg-1",
      p_transforms: [{ itemId: "item-1", rotationDeg: 45, x: 1, y: 0, z: 1 }],
      p_user_id: "user-1",
    });
    expect(result).toEqual({ ok: true, value: 3 });
  });

  it("envía p_expected_version 0 cuando la escena todavía no existe", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });

    await new SupabaseEscenaRepository(clientWithRpc(rpc)).guardar({ ...command, expectedSceneVersion: 0 });

    expect(rpc).toHaveBeenCalledWith("save_package_scene", expect.objectContaining({ p_expected_version: 0 }));
  });

  it.each([
    [{ message: "package.not_found" }, "package.not_found"],
    [{ message: "scene.version_conflict" }, "scene.version_conflict"],
    [{ message: "scene.item_not_found" }, "scene.item_not_found"],
    [{ message: "scene.too_many_items" }, "scene.too_many_items"],
    [{ code: "22P02", message: "invalid uuid" }, "scene.invalid_body"],
    [{ code: "XX000", message: "boom" }, "scene.persistence_error"],
  ])("traduce el error %j a %s", async (error, code) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error });

    const result = await new SupabaseEscenaRepository(clientWithRpc(rpc)).guardar(command);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
  });

  it("los códigos conocidos llevan un mensaje en español, no el código crudo", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { details: "4", message: "scene.version_conflict" },
    });

    const result = await new SupabaseEscenaRepository(clientWithRpc(rpc)).guardar(command);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("scene.version_conflict");
      expect(result.error.message).toBe("La escena cambió mientras guardabas. Vuelve a intentarlo.");
      expect(result.error.metadata).toEqual({ currentSceneVersion: 4 });
    }
  });
});

describe("SupabaseEscenaRepository.leer", () => {
  function clientWithTables(packageScenes: { data: unknown; error: unknown }, transforms?: { data: unknown; error: unknown }) {
    const from = vi.fn((table: string) => {
      if (table === "package_scenes") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: vi.fn().mockResolvedValue(packageScenes) }),
          }),
        };
      }
      return {
        select: () => ({ eq: vi.fn().mockResolvedValue(transforms ?? { data: [], error: null }) }),
      };
    });
    return { from } as unknown as SupabaseClient;
  }

  it("devuelve escena vacía y versión 0 cuando el paquete nunca guardó una escena", async () => {
    const client = clientWithTables({ data: null, error: null });

    const result = await new SupabaseEscenaRepository(client).leer("pkg-1");

    expect(result).toEqual({
      ok: true,
      value: { packageId: "pkg-1", sceneVersion: 0, transformaciones: [] },
    });
  });

  it("devuelve la escena guardada con sus transformaciones", async () => {
    const client = clientWithTables(
      { data: { package_id: "pkg-1", version: 2 }, error: null },
      { data: [{ item_id: "item-1", rotation_deg: 45, x: 1, y: 0, z: 1 }], error: null },
    );

    const result = await new SupabaseEscenaRepository(client).leer("pkg-1");

    expect(result).toEqual({
      ok: true,
      value: {
        packageId: "pkg-1",
        sceneVersion: 2,
        transformaciones: [{ itemId: "item-1", posicion: { x: 1, y: 0, z: 1 }, rotacionDeg: 45 }],
      },
    });
  });

  it("propaga el error de persistencia al leer la escena", async () => {
    const client = clientWithTables({ data: null, error: { message: "boom" } });

    const result = await new SupabaseEscenaRepository(client).leer("pkg-1");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("scene.persistence_error");
  });
});
