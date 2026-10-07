import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { EventPublisher } from "../application/event-publisher";
import { packageChannel, type DomainEvent } from "../domain/event-contracts";

/**
 * Publishes to the private Broadcast channel `package:{packageId}` through the
 * Realtime REST endpoint, so the server never keeps a WebSocket open. Never
 * uses `postgres_changes`. Rejects when Realtime does not accept the message.
 */
export class SupabaseBroadcastEventPublisher implements EventPublisher {
  constructor(private readonly client: SupabaseClient) {}

  async publish(event: DomainEvent): Promise<void> {
    const channel = this.client.channel(packageChannel(event.packageId), {
      config: { private: true },
    });

    try {
      const response = await channel.httpSend(event.type, event);

      if (!response.success) {
        throw new Error(`Realtime rejected ${event.eventId}: ${response.status} ${response.error}`);
      }
    } finally {
      await this.client.removeChannel(channel);
    }
  }
}
