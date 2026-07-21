import { channelsIntersect, type ChangeFeedEvent } from "./change-feed-sources";

/**
 * The in-process fan-out for live-update events (repo ADR 0021). The relay
 * publishes each routed event once; the hub delivers it to every subscriber
 * whose channel set intersects the event's channels. One hub lives per API
 * process — it is not a cross-process bus (the durable change_feed table is),
 * only the last hop from the relay to the SSE connections this instance holds.
 *
 * It reports its subscriber count so the relay can poll only while at least one
 * client is listening (start on 0→1, stop on 1→0), avoiding idle DB polling.
 */

/** A subscriber callback: invoked once per published event whose channels
 * intersect the subscription. It must not throw expecting the hub to surface
 * the error — a throw is swallowed to protect fan-out, so a listener owns its
 * own teardown. */
export type ChangeFeedListener = (event: ChangeFeedEvent) => void;

interface Subscription {
  channels: ReadonlySet<string>;
  listener: ChangeFeedListener;
}

export class ChangeFeedHub {
  private readonly subscriptions = new Set<Subscription>();
  private readonly onSubscriberCountChange?: (count: number) => void;

  constructor(
    options: { onSubscriberCountChange?: (count: number) => void } = {},
  ) {
    this.onSubscriberCountChange = options.onSubscriberCountChange;
  }

  get subscriberCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Registers a listener for the given channels and returns an idempotent
   * unsubscribe. The subscriber-count callback fires on both edges so the relay
   * can start/stop with demand.
   */
  subscribe(
    channels: Iterable<string>,
    listener: ChangeFeedListener,
  ): () => void {
    const subscription: Subscription = {
      channels: new Set(channels),
      listener,
    };
    this.subscriptions.add(subscription);
    this.onSubscriberCountChange?.(this.subscriptions.size);

    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      this.subscriptions.delete(subscription);
      this.onSubscriberCountChange?.(this.subscriptions.size);
    };
  }

  /** Delivers an event to every subscriber whose channels intersect it. A
   * throwing listener never blocks delivery to the others. */
  publish(event: ChangeFeedEvent): void {
    for (const subscription of this.subscriptions) {
      if (channelsIntersect(subscription.channels, event.channels)) {
        try {
          subscription.listener(event);
        } catch {
          // A dead/slow connection must not stall fan-out; the SSE route owns
          // its own teardown when its stream breaks.
        }
      }
    }
  }
}
