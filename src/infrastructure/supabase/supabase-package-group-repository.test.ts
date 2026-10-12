import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PackageModuleAddedEvent } from "../../modules/events/domain/event-contracts";
import { SupabasePackageGroupRepository } from "./supabase-package-group-repository";

const event: PackageModuleAddedEvent = {
  eventId: "evt-1",
  occurredAt: "2026-10-12T10:00:00.000Z",
  packageId: "pkg-1",
  payload: { itemId: "item-1", moduleId: "mod-1" },
  schemaVersion: 1,
  type: "package.module.added",
  userId: "user-1",
};

const command = {
  events: [event],
  expectedVersion: 3,
  groupId: "grp-1",
  name: "Zona de bienvenida",
  packageId: "pkg-1",
  parentGroupId: null,
  userId: "user-1",
};

const clientWithRpc = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as SupabaseClient;

function clientWithTables(tables: Record<string, { data: unknown; error: unknown }>) {
  const from = vi.fn((table: string) => ({
    select: () => ({ eq: vi.fn().mockResolvedValue(tables[table]) }),
  }));
  return { client: { from } as unknown as SupabaseClient, from };
}

describe("SupabasePackageGroupRepository", () => {
  it("createGroup invoca create_package_group con todos los parámetros y mapea la respuesta", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { depth: 1, groupId: "grp-1", itemIds: ["item-1"], packageVersion: 4 },
      error: null,
    });

    const result = await new SupabasePackageGroupRepository(clientWithRpc(rpc)).createGroup(command);

    expect(rpc).toHaveBeenCalledWith("create_package_group", {
      p_correlation_id: null,
      p_events: [event],
      p_expected_version: 3,
      p_group_id: "grp-1",
      p_name: "Zona de bienvenida",
      p_package_id: "pkg-1",
      p_parent_group_id: null,
      p_user_id: "user-1",
    });
    expect(result).toEqual({
      ok: true,
      value: { depth: 1, groupId: "grp-1", itemIds: ["item-1"], packageVersion: 4 },
    });
  });

  it.each([
    [{ message: "package.group_depth_exceeded" }, "package.group_depth_exceeded"],
    [{ message: "package.not_found" }, "package.not_found"],
    [{ message: "package.version_conflict" }, "package.version_conflict"],
    [{ code: "23503", message: "fk violation" }, "package.module_not_found"],
    [{ code: "22P02", message: "invalid uuid" }, "package.invalid_group"],
    [{ code: "XX000", message: "boom" }, "package.persistence_error"],
  ])("traduce el error %j a %s", async (error, code) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error });

    const result = await new SupabasePackageGroupRepository(clientWithRpc(rpc)).createGroup(command);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
  });

  it("los códigos conocidos llevan un mensaje en español, no el código crudo", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "package.version_conflict" } });

    const result = await new SupabasePackageGroupRepository(clientWithRpc(rpc)).createGroup(command);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("package.version_conflict");
      expect(result.error.message).toBe("El paquete cambió mientras guardabas. Vuelve a intentarlo.");
    }
  });

  it("createGroup convierte una excepción en package.persistence_error", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await new SupabasePackageGroupRepository(clientWithRpc(rpc)).createGroup(command);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.persistence_error");
  });

  it("addItemToGroup invoca add_package_item_to_group y devuelve la versión", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 7, error: null });

    const result = await new SupabasePackageGroupRepository(clientWithRpc(rpc)).addItemToGroup(event, "grp-1", 6);

    expect(rpc).toHaveBeenCalledWith("add_package_item_to_group", {
      p_correlation_id: null,
      p_event: event,
      p_expected_version: 6,
      p_group_id: "grp-1",
    });
    expect(result).toEqual({ ok: true, value: 7 });
  });

  it("propaga el correlationId a create_package_group y add_package_item_to_group", async () => {
    const createRpc = vi.fn().mockResolvedValue({
      data: { depth: 1, groupId: "grp-1", itemIds: [], packageVersion: 4 },
      error: null,
    });
    await new SupabasePackageGroupRepository(clientWithRpc(createRpc)).createGroup({
      ...command,
      correlationId: "corr-1",
    });
    expect(createRpc).toHaveBeenCalledWith(
      "create_package_group",
      expect.objectContaining({ p_correlation_id: "corr-1" }),
    );

    const addRpc = vi.fn().mockResolvedValue({ data: 7, error: null });
    await new SupabasePackageGroupRepository(clientWithRpc(addRpc)).addItemToGroup(event, "grp-1", 6, "corr-2");
    expect(addRpc).toHaveBeenCalledWith(
      "add_package_item_to_group",
      expect.objectContaining({ p_correlation_id: "corr-2" }),
    );
  });

  it("addItemToGroup traduce package.group_not_found", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "package.group_not_found" } });

    const result = await new SupabasePackageGroupRepository(clientWithRpc(rpc)).addItemToGroup(event, "grp-x", 6);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.group_not_found");
  });

  it("getStructure lee grupos y el grupo de cada hoja", async () => {
    const { client, from } = clientWithTables({
      package_groups: {
        data: [
          { id: "zona", name: "Zona de bienvenida", parent_group_id: null },
          { id: "sub", name: "Sub", parent_group_id: "zona" },
        ],
        error: null,
      },
      package_items: {
        data: [
          { group_id: "zona", id: "item-1" },
          { group_id: null, id: "item-2" },
        ],
        error: null,
      },
    });

    const result = await new SupabasePackageGroupRepository(client).getStructure("pkg-1");

    expect(from).toHaveBeenCalledWith("package_groups");
    expect(from).toHaveBeenCalledWith("package_items");
    expect(result).toEqual({
      ok: true,
      value: {
        groups: [
          { groupId: "zona", name: "Zona de bienvenida", parentGroupId: null },
          { groupId: "sub", name: "Sub", parentGroupId: "zona" },
        ],
        itemGroupIds: { "item-1": "zona", "item-2": null },
      },
    });
  });

  it("getStructure devuelve package.persistence_error si falla la lectura", async () => {
    const { client } = clientWithTables({
      package_groups: { data: null, error: { message: "denied" } },
      package_items: { data: [], error: null },
    });

    const result = await new SupabasePackageGroupRepository(client).getStructure("pkg-1");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.persistence_error");
  });

  describe("gestión de grupos (DECOR-43)", () => {
    const target = { expectedVersion: 5, groupId: "grp-1", packageId: "pkg-1", userId: "user-1" };

    it("renameGroup invoca rename_package_group y mapea la respuesta", async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: { groupId: "grp-1", name: "Sala", structureVersion: 3 },
        error: null,
      });

      const result = await new SupabasePackageGroupRepository(clientWithRpc(rpc)).renameGroup({
        ...target,
        name: "Sala",
      });

      expect(rpc).toHaveBeenCalledWith("rename_package_group", {
        p_expected_version: 5,
        p_group_id: "grp-1",
        p_name: "Sala",
        p_package_id: "pkg-1",
        p_user_id: "user-1",
      });
      expect(result).toEqual({ ok: true, value: { groupId: "grp-1", name: "Sala", structureVersion: 3 } });
    });

    it("deleteGroup invoca delete_package_group y mapea la respuesta", async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: { groupId: "grp-1", parentGroupId: "grp-0", promotedGroups: 1, promotedItems: 2, structureVersion: 4 },
        error: null,
      });

      const result = await new SupabasePackageGroupRepository(clientWithRpc(rpc)).deleteGroup(target);

      expect(rpc).toHaveBeenCalledWith("delete_package_group", {
        p_expected_version: 5,
        p_group_id: "grp-1",
        p_package_id: "pkg-1",
        p_user_id: "user-1",
      });
      expect(result).toEqual({
        ok: true,
        value: { groupId: "grp-1", parentGroupId: "grp-0", promotedGroups: 1, promotedItems: 2, structureVersion: 4 },
      });
    });

    it.each([
      [{ message: "package.group_not_found" }, "package.group_not_found"],
      [{ message: "package.group_integrity" }, "package.group_integrity"],
      [{ message: "package.version_conflict" }, "package.version_conflict"],
      [{ code: "23503", message: "fk violation" }, "package.group_integrity"],
      [{ code: "XX000", message: "boom" }, "package.persistence_error"],
    ])("deleteGroup traduce el error %j a %s", async (error, code) => {
      const rpc = vi.fn().mockResolvedValue({ data: null, error });

      const result = await new SupabasePackageGroupRepository(clientWithRpc(rpc)).deleteGroup(target);

      expect(!result.ok && result.error.code).toBe(code);
    });

    it("renameGroup traduce el nombre inválido y una respuesta vacía", async () => {
      const invalid = vi.fn().mockResolvedValue({ data: null, error: { message: "package.invalid_group_name" } });
      const empty = vi.fn().mockResolvedValue({ data: null, error: null });

      const invalidResult = await new SupabasePackageGroupRepository(clientWithRpc(invalid)).renameGroup({
        ...target,
        name: "",
      });
      const emptyResult = await new SupabasePackageGroupRepository(clientWithRpc(empty)).renameGroup({
        ...target,
        name: "Sala",
      });

      expect(!invalidResult.ok && invalidResult.error.code).toBe("package.invalid_group_name");
      expect(!emptyResult.ok && emptyResult.error.code).toBe("package.persistence_error");
    });
  });
});
