import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { packageModuleAddedExample } from "../domain/event-examples";
import { SupabaseEventOutbox } from "./supabase-event-outbox";

vi.mock("server-only", () => ({}));

const clientWith = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as SupabaseClient;

describe("SupabaseEventOutbox", () => {
  it("commits the package change and event through one RPC and returns the new version", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 3, error: null });

    const result = await new SupabaseEventOutbox(clientWith(rpc)).commit(packageModuleAddedExample, 2);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("commit_package_change", {
      p_event: packageModuleAddedExample,
      p_expected_version: 2,
    });
    expect(result).toEqual({ ok: true, value: 3 });
  });

  it("sends a null expected version when none is given", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 2, error: null });

    await new SupabaseEventOutbox(clientWith(rpc)).commit(packageModuleAddedExample);

    expect(rpc.mock.calls[0][1]).toMatchObject({ p_expected_version: null });
  });

  it.each([
    "package.not_found",
    "package.item_not_found",
    "package.version_conflict",
    "event.duplicate",
    "event.invalid",
    "event.unsupported_type",
    "event.unsupported_version",
  ])("maps the RPC error %s to a domain error with the same code", async (code) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "P0001", message: code } });

    const result = await new SupabaseEventOutbox(clientWith(rpc)).commit(packageModuleAddedExample);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
  });

  it("maps a foreign key violation to package.module_not_found", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "23503", message: "violates foreign key constraint" },
    });

    const result = await new SupabaseEventOutbox(clientWith(rpc)).commit(packageModuleAddedExample);

    expect(!result.ok && result.error.code).toBe("package.module_not_found");
  });

  it("maps unknown and thrown failures to outbox.persistence_error", async () => {
    const unknown = vi.fn().mockResolvedValue({ data: null, error: { code: "08006", message: "connection lost" } });
    const thrown = vi.fn().mockRejectedValue(new Error("fetch failed"));

    const a = await new SupabaseEventOutbox(clientWith(unknown)).commit(packageModuleAddedExample);
    const b = await new SupabaseEventOutbox(clientWith(thrown)).commit(packageModuleAddedExample);

    expect(!a.ok && a.error).toMatchObject({ code: "outbox.persistence_error", message: "connection lost" });
    expect(!b.ok && b.error).toMatchObject({ code: "outbox.persistence_error", message: "fetch failed" });
  });

  it("claims initial events and maps rows", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ event: packageModuleAddedExample, event_id: packageModuleAddedExample.eventId }],
      error: null,
    });

    const result = await new SupabaseEventOutbox(clientWith(rpc)).claimInitial(10);

    expect(rpc).toHaveBeenCalledWith("claim_initial_domain_events", { p_limit: 10 });
    expect(result).toEqual({
      ok: true,
      value: [{ event: packageModuleAddedExample, eventId: packageModuleAddedExample.eventId }],
    });
  });

  it("marks published and records failures through their RPCs", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const outbox = new SupabaseEventOutbox(clientWith(rpc));

    expect((await outbox.markPublished("evt-1")).ok).toBe(true);
    expect((await outbox.recordFailure("evt-1", "503")).ok).toBe(true);
    expect(rpc).toHaveBeenNthCalledWith(1, "mark_domain_event_published", { p_event_id: "evt-1" });
    expect(rpc).toHaveBeenNthCalledWith(2, "record_domain_event_failure", { p_error: "503", p_event_id: "evt-1" });
  });

  it("returns a persistence error when claiming fails", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "permission denied" } });

    const result = await new SupabaseEventOutbox(clientWith(rpc)).claimInitial(10);

    expect(!result.ok && result.error.code).toBe("outbox.persistence_error");
  });
});
