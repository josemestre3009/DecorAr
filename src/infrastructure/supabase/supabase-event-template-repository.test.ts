import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SupabaseEventTemplateRepository } from "./supabase-event-template-repository";

const clientWith = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as SupabaseClient;

describe("SupabaseEventTemplateRepository", () => {
  it("createFromPackage invoca la RPC y mapea el resultado con conteos", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        capacityM2: 80,
        colors: ["#fff"],
        eventType: "boda",
        groupCount: 2,
        id: "tpl-1",
        itemCount: 3,
        name: "Boda base",
        notes: "Notas",
        spaceType: "salonSocial",
        style: "elegante",
      },
      error: null,
    });

    const result = await new SupabaseEventTemplateRepository(clientWith(rpc)).createFromPackage({
      name: "Boda base",
      ownerId: "user-1",
      packageId: "pkg-1",
    });

    expect(rpc).toHaveBeenCalledWith("create_event_template_from_package", {
      p_name: "Boda base",
      p_owner_id: "user-1",
      p_source_package_id: "pkg-1",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        capacityM2: 80,
        colors: ["#fff"],
        eventType: "boda",
        groupCount: 2,
        id: "tpl-1",
        itemCount: 3,
        name: "Boda base",
        notes: "Notas",
        spaceType: "salonSocial",
        style: "elegante",
      },
    });
  });

  it("instantiate invoca la RPC del evento y mapea versión y conteos", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { capacityM2: null, id: "pkg-new", name: "Nuevo", spaceType: null, version: 1 },
      error: null,
    });

    const result = await new SupabaseEventTemplateRepository(clientWith(rpc)).instantiate({
      name: "Nuevo",
      ownerId: "user-1",
      templateId: "tpl-1",
    });

    expect(rpc).toHaveBeenCalledWith("create_package_from_event_template", {
      p_event_name: "Nuevo",
      p_owner_id: "user-1",
      p_template_id: "tpl-1",
    });
    expect(result.ok && result.value).toEqual({
      capacityM2: null,
      colors: [],
      eventType: null,
      groupCount: 0,
      id: "pkg-new",
      itemCount: 0,
      name: "Nuevo",
      notes: "",
      spaceType: null,
      style: null,
      version: 1,
    });
  });

  it("rename invoca la RPC y devuelve id y nombre", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: "tpl-1", name: "Nuevo" }, error: null });

    const result = await new SupabaseEventTemplateRepository(clientWith(rpc)).rename({
      name: "Nuevo",
      ownerId: "user-1",
      templateId: "tpl-1",
    });

    expect(rpc).toHaveBeenCalledWith("rename_event_template", {
      p_name: "Nuevo",
      p_owner_id: "user-1",
      p_template_id: "tpl-1",
    });
    expect(result).toEqual({ ok: true, value: { id: "tpl-1", name: "Nuevo" } });
  });

  it("delete invoca la RPC y devuelve el booleano", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    const result = await new SupabaseEventTemplateRepository(clientWith(rpc)).delete({
      ownerId: "user-1",
      templateId: "tpl-1",
    });

    expect(rpc).toHaveBeenCalledWith("delete_event_template", {
      p_owner_id: "user-1",
      p_template_id: "tpl-1",
    });
    expect(result).toEqual({ ok: true, value: true });
  });

  it.each([
    "template.not_found",
    "template.invalid_name",
    "template.invalid_source",
    "package.not_found",
    "package.invalid_name",
    "package.invalid_source",
  ])("mapea el código conocido '%s' directamente a DomainError", async (code) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "P0001", message: code } });

    const result = await new SupabaseEventTemplateRepository(clientWith(rpc)).createFromPackage({
      name: "X",
      ownerId: "user-1",
      packageId: "pkg-1",
    });

    expect(!result.ok && result.error.code).toBe(code);
  });

  it("mapea errores desconocidos a template.persistence_error", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "unexpected failure" },
    });

    const result = await new SupabaseEventTemplateRepository(clientWith(rpc)).delete({
      ownerId: "user-1",
      templateId: "tpl-1",
    });

    expect(!result.ok && result.error.code).toBe("template.persistence_error");
    expect(!result.ok && result.error.message).toContain("unexpected failure");
  });

  it("sin datos ni error responde template.persistence_error", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    const result = await new SupabaseEventTemplateRepository(clientWith(rpc)).rename({
      name: "X",
      ownerId: "user-1",
      templateId: "tpl-1",
    });

    expect(!result.ok && result.error.code).toBe("template.persistence_error");
  });

  it("captura excepciones del cliente como template.persistence_error", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("Network timeout"));

    const result = await new SupabaseEventTemplateRepository(clientWith(rpc)).instantiate({
      name: "X",
      ownerId: "user-1",
      templateId: "tpl-1",
    });

    expect(!result.ok && result.error.code).toBe("template.persistence_error");
    expect(!result.ok && result.error.message).toBe("Network timeout");
  });
});
