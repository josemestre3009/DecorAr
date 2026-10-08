import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getPublicSupabaseEnv } from "../../lib/env";
import { packageChannel, parseDomainEvent, type DomainEvent } from "../../modules/events/domain/event-contracts";

export function createClient() {
  const { url, publishableKey } = getPublicSupabaseEnv();

  return createBrowserClient(url, publishableKey);
}

export type PackageChannelStatus = "subscribed" | "denied" | "closed";

type BrowserRealtime = Pick<SupabaseClient, "channel" | "removeChannel" | "realtime">;

/**
 * The only Realtime use allowed in the browser (DECOR-30): listen on the
 * private Broadcast channel `package:{packageId}`. Realtime authorizes the
 * join against RLS on `realtime.messages`, so a foreign or anonymous
 * subscriber gets `denied`. The browser never publishes and never uses
 * `postgres_changes`. Returns the unsubscribe function.
 */
export async function subscribeToPackageChannel(
  client: BrowserRealtime,
  packageId: string,
  onEvent: (event: DomainEvent) => void,
  onStatus: (status: PackageChannelStatus) => void = () => {},
): Promise<() => Promise<void>> {
  // Private channels need the user's JWT on the socket before joining.
  await client.realtime.setAuth();

  const channel = client
    .channel(packageChannel(packageId), { config: { private: true } })
    .on("broadcast", { event: "*" }, ({ payload }) => {
      const parsed = parseDomainEvent(payload);

      if (parsed.ok && parsed.value.packageId === packageId) {
        onEvent(parsed.value);
      }
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") onStatus("subscribed");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onStatus("denied");
      else onStatus("closed");
    });

  return async () => {
    await client.removeChannel(channel);
  };
}
