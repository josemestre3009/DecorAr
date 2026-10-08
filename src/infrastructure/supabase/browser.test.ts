import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { packageModuleAddedExample } from "../../modules/events/domain/event-examples";
import { subscribeToPackageChannel } from "./browser";

vi.mock("@supabase/ssr", () => ({ createBrowserClient: vi.fn() }));

type Listener = (message: { payload: unknown }) => void;

function fakeClient(status: string) {
  let listener: Listener = () => {};
  const channel = {
    on: vi.fn((_type: string, _filter: unknown, callback: Listener) => {
      listener = callback;
      return channel;
    }),
    subscribe: vi.fn((callback: (status: string) => void) => {
      callback(status);
      return channel;
    }),
  };
  const client = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => "ok"),
    realtime: { setAuth: vi.fn(async () => {}) },
  };

  return {
    client: client as unknown as Pick<SupabaseClient, "channel" | "removeChannel" | "realtime">,
    raw: client,
    channel,
    emit: (payload: unknown) => listener({ payload }),
  };
}

describe("subscribeToPackageChannel", () => {
  const packageId = packageModuleAddedExample.packageId;

  it("se une al canal privado package:{packageId} con el JWT de la sesión", async () => {
    const fake = fakeClient("SUBSCRIBED");
    const onStatus = vi.fn();

    await subscribeToPackageChannel(fake.client, packageId, vi.fn(), onStatus);

    expect(fake.raw.realtime.setAuth).toHaveBeenCalledTimes(1);
    expect(fake.raw.channel).toHaveBeenCalledWith(`package:${packageId}`, { config: { private: true } });
    expect(fake.channel.on).toHaveBeenCalledWith("broadcast", { event: "*" }, expect.any(Function));
    expect(onStatus).toHaveBeenCalledWith("subscribed");
  });

  it("informa denied cuando Realtime rechaza al usuario ajeno o anónimo", async () => {
    const onStatus = vi.fn();

    await subscribeToPackageChannel(fakeClient("CHANNEL_ERROR").client, packageId, vi.fn(), onStatus);

    expect(onStatus).toHaveBeenCalledWith("denied");
  });

  it("entrega sólo eventos válidos del paquete suscrito", async () => {
    const fake = fakeClient("SUBSCRIBED");
    const onEvent = vi.fn();

    await subscribeToPackageChannel(fake.client, packageId, onEvent);
    fake.emit(packageModuleAddedExample);
    fake.emit({ ...packageModuleAddedExample, packageId: "otro" });
    fake.emit({ type: "budget.recalculated", totalCop: -1 });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(packageModuleAddedExample);
  });

  it("devuelve una función que abandona el canal", async () => {
    const fake = fakeClient("SUBSCRIBED");
    const unsubscribe = await subscribeToPackageChannel(fake.client, packageId, vi.fn());

    await unsubscribe();

    expect(fake.raw.removeChannel).toHaveBeenCalledWith(fake.channel);
  });

  it("el navegador no publica ni usa postgres_changes", async () => {
    const code = await readFile(resolve("src/infrastructure/supabase/browser.ts"), "utf8");

    expect(code).not.toMatch(/["']postgres_changes["']/);
    expect(code).not.toMatch(/\.(send|httpSend)\(/);
    expect(code).not.toMatch(/\.from\(/);
  });
});
