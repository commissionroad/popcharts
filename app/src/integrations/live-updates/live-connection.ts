/**
 * The browser end of the live-updates transport (repo ADR 0021). Owns exactly
 * one `EventSource` to the API's `GET /events`, shared by every subscriber on
 * the page, and turns its frames into per-channel callbacks.
 *
 * Framework-free on purpose: the React provider is a thin wrapper, so the
 * tricky parts — channel refcounting, reopen-on-channel-change, resume,
 * dedup, tab-visibility, and backoff — are unit testable without a DOM.
 *
 * Two invariants worth stating, because both cost real money if broken:
 *  - **No subscribers, no socket.** The server relay only polls `change_feed`
 *    while an SSE client is connected, so an idle browser connection would
 *    keep a DB poll alive for nothing.
 *  - **A signal is only ever a nudge.** Handlers re-read authoritative REST
 *    state; nothing here is rendered directly, so a duplicate, out-of-order,
 *    or replayed signal costs at most one redundant refetch.
 */

/** The subset of `EventSource` this module uses, so tests can supply a fake. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
}

/**
 * What a subscriber receives. `change` means "this entity changed, re-read it";
 * `reset` means the resume cursor fell outside the server's retention window,
 * so only a cold refetch can close the gap.
 */
export type LiveSignal =
  | {
      type: "change";
      /** `change_feed.id` — the resume cursor, and the client dedup key. */
      id: string;
      channels: string[];
      /** Originating table, e.g. `receipt_placed_events`. */
      source: string;
      marketId: string | null;
      owner: string | null;
    }
  | { type: "reset"; reason: string };

export type LiveSignalHandler = (signal: LiveSignal) => void;

/** Injected collaborators + tunables; only `baseUrl` is required in the app. */
export interface LiveConnectionOptions {
  /** API origin (not the Next proxy — a serverless proxy cannot hold a stream). */
  baseUrl: string;
  createEventSource?: (url: string) => EventSourceLike;
  /** Coalesces subscribe/unsubscribe churn during a route change into one reopen. */
  reopenDelayMs?: number;
  maxBackoffMs?: number;
  onError?: (error: unknown) => void;
}

const DEFAULT_REOPEN_DELAY_MS = 50;
const DEFAULT_MAX_BACKOFF_MS = 30_000;
/** Bounds the dedup set; far larger than any realistic replay page. */
const SEEN_ID_LIMIT = 500;

export class LiveConnection {
  private readonly baseUrl: string;
  private readonly createEventSource: (url: string) => EventSourceLike;
  private readonly reopenDelayMs: number;
  private readonly maxBackoffMs: number;
  private readonly onError: ((error: unknown) => void) | undefined;

  private readonly handlers = new Map<string, Set<LiveSignalHandler>>();
  private source: EventSourceLike | null = null;
  /** The channel set the open socket was built for; null when disconnected. */
  private openedChannels: string | null = null;
  /** Highest `change_feed.id` seen — replayed via `?lastEventId` on reopen. */
  private lastEventId: string | null = null;
  private readonly seenIds = new Set<string>();
  private readonly seenOrder: string[] = [];
  private reopenTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = 0;
  private paused = false;
  private disposed = false;

  constructor(options: LiveConnectionOptions) {
    this.baseUrl = options.baseUrl;
    this.createEventSource =
      options.createEventSource ?? ((url) => new EventSource(url) as EventSourceLike);
    this.reopenDelayMs = options.reopenDelayMs ?? DEFAULT_REOPEN_DELAY_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.onError = options.onError;
  }

  /**
   * Registers `handler` for `channel`, opening or re-opening the shared socket
   * as needed. Returns an unsubscribe that closes the socket when it removes
   * the last subscriber.
   */
  subscribe(channel: string, handler: LiveSignalHandler): () => void {
    const existing = this.handlers.get(channel);
    if (existing) {
      existing.add(handler);
    } else {
      this.handlers.set(channel, new Set([handler]));
    }
    this.scheduleReconcile();

    return () => {
      const handlers = this.handlers.get(channel);
      if (!handlers) {
        return;
      }
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.handlers.delete(channel);
      }
      this.scheduleReconcile();
    };
  }

  /** Tab hidden: drop the socket so the server stops polling for us. */
  pause(): void {
    if (this.paused) {
      return;
    }
    this.paused = true;
    this.closeSource();
  }

  /** Tab visible: reconnect and replay whatever arrived while we were away. */
  resume(): void {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    this.backoffMs = 0;
    this.scheduleReconcile();
  }

  dispose(): void {
    this.disposed = true;
    this.clearReopenTimer();
    this.closeSource();
    this.handlers.clear();
  }

  /** The currently subscribed channels, sorted — the socket's identity. */
  private channelKey(): string {
    return [...this.handlers.keys()].sort().join(",");
  }

  private scheduleReconcile(): void {
    if (this.disposed || this.reopenTimer) {
      return;
    }
    this.reopenTimer = setTimeout(() => {
      this.reopenTimer = null;
      this.reconcile();
    }, this.reopenDelayMs);
  }

  private clearReopenTimer(): void {
    if (this.reopenTimer) {
      clearTimeout(this.reopenTimer);
      this.reopenTimer = null;
    }
  }

  // No disposed-guard needed: dispose() clears any pending timer and
  // scheduleReconcile() refuses to arm a new one, so this cannot run after it.
  private reconcile(): void {
    const channels = this.channelKey();

    if (channels === "" || this.paused) {
      this.closeSource();
      return;
    }
    if (this.source && this.openedChannels === channels) {
      return;
    }

    this.closeSource();
    this.open(channels);
  }

  private open(channels: string): void {
    let url: string;
    try {
      url = this.buildUrl(channels);
    } catch (error) {
      // A malformed base URL is a config problem, not a runtime one to retry.
      this.onError?.(error);
      return;
    }

    const source = this.createEventSource(url);
    this.source = source;
    this.openedChannels = channels;

    source.addEventListener("change", (event) => this.handleChange(event));
    source.addEventListener("reset", (event) => this.handleReset(event));
    source.addEventListener("error", () => this.handleError());
  }

  private buildUrl(channels: string): string {
    const base = this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`;
    const url = new URL("events", base);
    url.searchParams.set("channels", channels);
    if (this.lastEventId !== null) {
      // A socket we construct cannot send the Last-Event-ID header, so the
      // route's query fallback is what makes our own reopens resume.
      url.searchParams.set("lastEventId", this.lastEventId);
    }
    return url.toString();
  }

  private handleChange(event: MessageEvent): void {
    let payload: {
      id?: unknown;
      channels?: unknown;
      source?: unknown;
      marketId?: unknown;
      owner?: unknown;
    };
    try {
      payload = JSON.parse(String(event.data ?? "")) as typeof payload;
    } catch (error) {
      this.onError?.(error);
      return;
    }

    const id = typeof payload.id === "string" ? payload.id : null;
    if (id === null || this.seenIds.has(id)) {
      return;
    }
    this.rememberId(id);
    this.advanceCursor(id);

    const channels = Array.isArray(payload.channels)
      ? payload.channels.filter((c): c is string => typeof c === "string")
      : [];
    const signal: LiveSignal = {
      type: "change",
      id,
      channels,
      source: typeof payload.source === "string" ? payload.source : "",
      marketId: typeof payload.marketId === "string" ? payload.marketId : null,
      owner: typeof payload.owner === "string" ? payload.owner : null,
    };

    for (const channel of channels) {
      this.emit(channel, signal);
    }
  }

  private handleReset(event: MessageEvent): void {
    let reason = "cursor-too-old";
    try {
      const parsed = JSON.parse(String(event.data ?? "{}")) as {
        reason?: unknown;
      };
      if (typeof parsed.reason === "string") {
        reason = parsed.reason;
      }
    } catch {
      // Keep the default reason; a reset is actionable without its payload.
    }
    // The cursor is useless past the retention window; drop it so the next
    // reopen starts from the tip instead of asking for a gap we cannot get.
    this.lastEventId = null;
    const signal: LiveSignal = { type: "reset", reason };
    for (const channel of [...this.handlers.keys()]) {
      this.emit(channel, signal);
    }
  }

  private handleError(): void {
    // EventSource retries transient drops itself; it gives up permanently on a
    // non-200, so we reopen with jittered backoff to cover that case.
    this.closeSource();
    if (this.disposed || this.paused || this.handlers.size === 0) {
      return;
    }
    this.backoffMs = this.backoffMs
      ? Math.min(this.backoffMs * 2, this.maxBackoffMs)
      : this.reopenDelayMs;
    const jittered = this.backoffMs * (0.5 + Math.random() / 2);
    this.clearReopenTimer();
    this.reopenTimer = setTimeout(() => {
      this.reopenTimer = null;
      this.reconcile();
    }, jittered);
  }

  private emit(channel: string, signal: LiveSignal): void {
    const handlers = this.handlers.get(channel);
    if (!handlers) {
      return;
    }
    for (const handler of [...handlers]) {
      try {
        handler(signal);
      } catch (error) {
        // One bad subscriber must not stop the others from being told.
        this.onError?.(error);
      }
    }
  }

  private rememberId(id: string): void {
    this.seenIds.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > SEEN_ID_LIMIT) {
      // Drop the whole window rather than evict one id at a time: dedup is an
      // optimisation, so forgetting an id costs at most one redundant refetch.
      this.seenOrder.length = 0;
      this.seenIds.clear();
      this.seenIds.add(id);
      this.seenOrder.push(id);
    }
  }

  /**
   * Tracks the highest id for resume. A late-arriving lower id is still
   * delivered (the server recovers those); it just does not move the cursor.
   */
  private advanceCursor(id: string): void {
    const current = this.lastEventId;
    if (
      current === null ||
      id.length > current.length ||
      (id.length === current.length && id > current)
    ) {
      this.lastEventId = id;
    }
  }

  private closeSource(): void {
    if (this.source) {
      this.source.close();
      this.source = null;
    }
    this.openedChannels = null;
  }
}
