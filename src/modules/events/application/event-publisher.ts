import type { DomainEvent } from "../domain/event-contracts";

/**
 * Publishes MVP events to the private channel `package:{packageId}`.
 * Concrete adapters live in the events infrastructure layer.
 */
export interface EventPublisher {
  publish(event: DomainEvent): Promise<void>;
}
