import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { packageModuleAddedExample } from "../domain/event-examples";
import { SupabaseBroadcastEventPublisher } from "./supabase-broadcast-event-publisher";

vi.mock("server-only", () => ({}));

function fakeClient(httpSend: ReturnType<typeof vi.fn>) {
  const channel = { httpSend, on: vi.fn() };
  const client = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => "ok"),
  };

  return { channel, client };
}

describe("SupabaseBroadcastEventPublisher", () => {
  it("sends the event to the private channel package:{packageId} named by its type", async () => {
    const { channel, client } = fakeClient(vi.fn().mockResolvedValue({ success: true }));

    await new SupabaseBroadcastEventPublisher(client as unknown as SupabaseClient).publish(
      packageModuleAddedExample,
    );

    expect(client.channel).toHaveBeenCalledWith(`package:${packageModuleAddedExample.packageId}`, {
      config: { private: true },
    });
    expect(channel.httpSend).toHaveBeenCalledWith("package.module.added", packageModuleAddedExample);
    expect(channel.on).not.toHaveBeenCalled();
    expect(client.removeChannel).toHaveBeenCalledWith(channel);
  });

  it("rejects when Realtime does not accept the message and still removes the channel", async () => {
    const { channel, client } = fakeClient(
      vi.fn().mockResolvedValue({ error: "Unauthorized", status: 401, success: false }),
    );

    await expect(
      new SupabaseBroadcastEventPublisher(client as unknown as SupabaseClient).publish(
        packageModuleAddedExample,
      ),
    ).rejects.toThrow("401 Unauthorized");
    expect(client.removeChannel).toHaveBeenCalledWith(channel);
  });

  it("propagates transport errors and removes the channel", async () => {
    const { channel, client } = fakeClient(vi.fn().mockRejectedValue(new Error("Request timeout")));

    await expect(
      new SupabaseBroadcastEventPublisher(client as unknown as SupabaseClient).publish(
        packageModuleAddedExample,
      ),
    ).rejects.toThrow("Request timeout");
    expect(client.removeChannel).toHaveBeenCalledWith(channel);
  });
});
