import { Elysia, sse, t } from "elysia";

import {
  changeFeedHub,
  changeFeedTip,
  replayChangeFeed,
} from "src/live/change-feed-service";
import { changeFeedEventStream } from "src/live/change-feed-stream";

/** Cap the channels one connection may fan in, so a single request cannot ask
 * the hub to match an unbounded subscription set. */
const MAX_CHANNELS = 64;

function parseChannels(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  const channels = new Set<string>();
  for (const part of raw.split(",")) {
    const channel = part.trim();
    if (channel.length > 0) {
      channels.add(channel);
    }
    if (channels.size >= MAX_CHANNELS) {
      break;
    }
  }
  return [...channels];
}

/**
 * The resume cursor: the Last-Event-ID header the browser replays, or the
 * `lastEventId` query fallback for non-EventSource clients. Returns null when
 * absent so the route can start a fresh client from the tip (only subsequent
 * updates) rather than replaying the whole retained window; a present-but-
 * unparseable value is treated as 0 (replay everything retained).
 */
function parseSinceId(raw: string | undefined): bigint | null {
  if (!raw) {
    return null;
  }
  try {
    const id = BigInt(raw);
    return id > 0n ? id : 0n;
  } catch {
    return 0n;
  }
}

/**
 * `GET /events` — the live-updates SSE endpoint (repo ADR 0021). Server→client
 * only; clients subscribe to channels (`?channels=market:31337:42,portfolio:0x…`)
 * and receive `change` signals to refetch the matching REST slice, plus
 * `ready`/`ping`/`reset` control frames. Resumes gap-free from `Last-Event-ID`.
 */
export const eventsRoutes = new Elysia({ prefix: "" }).get(
  "/events",
  async function* (context) {
    const channels = parseChannels(context.query.channels);
    const cursor = parseSinceId(
      context.headers["last-event-id"] ?? context.query.lastEventId,
    );
    // A cursorless (fresh) client resumes from the current tip so it receives
    // only updates from now on; a client with a cursor replays from it.
    const sinceId = cursor ?? (await changeFeedTip());

    const stream = changeFeedEventStream({
      hub: changeFeedHub(),
      channels,
      sinceId,
      replay: replayChangeFeed,
      signal: context.request.signal,
    });

    for await (const message of stream) {
      yield sse(message);
    }
  },
  {
    query: t.Object({
      channels: t.Optional(t.String()),
      lastEventId: t.Optional(t.String()),
    }),
    detail: {
      // Excluded from the OpenAPI contract and the generated api-client: this
      // is a text/event-stream, not a JSON response, and browsers consume it
      // directly via EventSource. Documenting a streamed generator has no
      // `responses` schema and fails spec validation anyway.
      hide: true,
      summary: "Live market updates stream (SSE)",
      tags: ["System"],
    },
  },
);
