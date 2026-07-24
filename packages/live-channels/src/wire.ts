/**
 * The `change` frame's JSON body — the one declaration of what the SSE relay
 * writes and the browser reads (repo ADR 0021).
 *
 * Both directions live here on purpose. When the server owned the field names
 * and the client re-listed them while hand-parsing, a rename was a silent
 * break: JSON has no schema, so the client would read `undefined` and carry on.
 * With one type and one function per direction, the same rename is a compile
 * error in whichever side did not follow.
 *
 * The signal is a nudge by default, per ADR 0021 — the on-chain coordinates
 * ride along so a subscriber can decide *what* to re-read, not so it can skip
 * re-reading. The lone exception the ADR carves out is the price `tick`: a
 * pregrad trade is append-mostly, so its resulting price rides the frame and
 * the chart appends it, rather than refetching the whole history for one point.
 * A gap in the tick `sequence` or a reconnect still falls back to a refetch.
 */

/** The pushed price datum on a `change` frame from a pregrad trade (repo ADR
 * 0021). Cents are the marginal YES/NO price after the trade, computed once at
 * the seam via the shared virtual LMSR; `sequence` is the market's receipt
 * ordinal, so the client detects a gap (`!= last + 1`) and resyncs. */
export interface PriceTickWire {
  /** ISO timestamp of the trade — the chart point's x value. */
  t: string;
  sequence: number;
  yesPriceCents: number;
  noPriceCents: number;
}

/** The wire body of a `change` frame. All bigints are strings: JSON has no
 * bigint, and `change_feed.id` outgrows `Number.MAX_SAFE_INTEGER` eventually. */
export interface ChangeSignalWire {
  /** `change_feed.id` — the resume cursor and the client's dedup key. */
  id: string;
  channels: string[];
  /** Originating table, e.g. `receipt_placed_events`. */
  source: string;
  op: string;
  chainId: number | null;
  marketId: string | null;
  owner: string | null;
  blockNumber: string | null;
  logIndex: number | null;
  /** Present only on a price-bearing source (a pregrad trade); absent
   * everywhere else, where the frame stays a pure nudge. */
  tick: PriceTickWire | null;
}

/**
 * The relay-side event a frame is built from: the same fields before
 * serialization, while the bigints are still bigints and the table keeps its
 * column name. The server aliases this as `ChangeFeedEvent` rather than
 * declaring its own copy, so the pre- and post-serialization shapes cannot
 * drift apart from each other either.
 */
export interface ChangeSignalSource {
  id: bigint;
  channels: string[];
  sourceTable: string;
  op: string;
  chainId: number | null;
  marketId: string | null;
  owner: string | null;
  blockNumber: bigint | null;
  logIndex: number | null;
  /** The price tick, already in wire shape (it is stored as JSON), or null. */
  tick: PriceTickWire | null;
}

/** Server side: the routed event → the frame body the client will parse. */
export function serializeChangeSignal(
  event: ChangeSignalSource,
): ChangeSignalWire {
  return {
    id: event.id.toString(),
    channels: event.channels,
    source: event.sourceTable,
    op: event.op,
    chainId: event.chainId,
    marketId: event.marketId,
    owner: event.owner,
    blockNumber:
      event.blockNumber === null ? null : event.blockNumber.toString(),
    logIndex: event.logIndex,
    tick: event.tick,
  };
}

/**
 * Client side: a parsed-JSON frame body → the typed signal, or null when the
 * frame is unusable.
 *
 * Deliberately lenient about everything except `id`. A frame with no usable id
 * cannot be deduped or resumed from, so it is dropped; every other field
 * degrades to an empty/null default rather than discarding a real signal,
 * because the cost of acting on a partial signal is one redundant refetch and
 * the cost of dropping it is a surface that never updates.
 */
export function parseChangeSignal(raw: unknown): ChangeSignalWire | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const frame = raw as Record<string, unknown>;

  if (typeof frame.id !== "string") {
    return null;
  }

  return {
    id: frame.id,
    channels: Array.isArray(frame.channels)
      ? frame.channels.filter(
          (channel): channel is string => typeof channel === "string",
        )
      : [],
    source: typeof frame.source === "string" ? frame.source : "",
    op: typeof frame.op === "string" ? frame.op : "",
    chainId: typeof frame.chainId === "number" ? frame.chainId : null,
    marketId: typeof frame.marketId === "string" ? frame.marketId : null,
    owner: typeof frame.owner === "string" ? frame.owner : null,
    blockNumber:
      typeof frame.blockNumber === "string" ? frame.blockNumber : null,
    logIndex: typeof frame.logIndex === "number" ? frame.logIndex : null,
    tick: parsePriceTick(frame.tick),
  };
}

/**
 * Validates a price tick — a parsed JSON frame field on the client, or a
 * `change_feed.payload` jsonb value on the relay. Returns the typed tick, or
 * null when any field is missing or the wrong type: an unusable tick degrades
 * to "no datum", which the surface treats as a plain nudge (refetch) rather
 * than a bad chart point.
 */
export function parsePriceTick(raw: unknown): PriceTickWire | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const tick = raw as Record<string, unknown>;

  if (
    typeof tick.t !== "string" ||
    typeof tick.sequence !== "number" ||
    typeof tick.yesPriceCents !== "number" ||
    typeof tick.noPriceCents !== "number"
  ) {
    return null;
  }

  return {
    t: tick.t,
    sequence: tick.sequence,
    yesPriceCents: tick.yesPriceCents,
    noPriceCents: tick.noPriceCents,
  };
}

/** The default `reset` reason, used when the frame carries no usable one. */
export const RESET_REASON_CURSOR_TOO_OLD = "cursor-too-old";

/** The wire body of a `reset` frame: the resume cursor fell outside the
 * server's retention window, so only a cold refetch can close the gap. */
export interface ResetSignalWire {
  reason: string;
}

/** Client side: a `reset` frame body → its reason. A reset is actionable even
 * with an unreadable payload, so an absent reason falls back to the default. */
export function parseResetReason(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) {
    return RESET_REASON_CURSOR_TOO_OLD;
  }
  const { reason } = raw as Record<string, unknown>;
  return typeof reason === "string" ? reason : RESET_REASON_CURSOR_TOO_OLD;
}
