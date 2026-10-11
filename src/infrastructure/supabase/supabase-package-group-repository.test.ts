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
    [{ code: "22P02", message: "invalid uuid" }, "package.group_not_found"],
    [{ code: "XX000", message: "boom" }, "package.persistence_error"],
  ])("traduce el error %j a %s", async (error, code) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error });

    const result = await new SupabasePackageGroupRepository(clientWithRpc(rpc)).createGroup(command);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
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
      p_event: event,
      p_expected_version: 6,
      p_group_id: "grp-1",
    });
    expect(result).toEqual({ ok: true, value: 7 });
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
});
