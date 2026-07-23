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
 * The signal stays a nudge, per ADR 0021 — nothing here is data to render. The
 * on-chain coordinates ride along so a subscriber can decide *what* to re-read,
 * not so it can skip re-reading.
 */

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
