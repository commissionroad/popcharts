// Observes the SSE endpoint over the real Elysia handler (repo ADR 0021): that
// `GET /events` opens a text/event-stream, sends the `ready` frame, and replays
// a matching change_feed row for the subscribed channel from Last-Event-ID 0.
// The stream's dedup/heartbeat/gap logic is unit-tested in change-feed-stream;
// this proves the HTTP wiring around it, plus that a disconnecting client
// releases its hub subscription instead of leaving the relay polling.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { app } from "src/api/index";
import { changeFeedHub } from "src/change-feed/service";
import { setDbForTesting } from "src/db/client";
import type { db as productionDb } from "src/db/client";
import * as schema from "src/db/schema";
import { createPgliteDb } from "src/test-support/pglite-db";

let dbc: typeof productionDb;
let teardownDb: () => Promise<void>;

beforeEach(async () => {
  ({ dbc, teardown: teardownDb } = await createPgliteDb());
  setDbForTesting(dbc);
});

afterEach(async () => {
  setDbForTesting(null);
  await teardownDb();
});

/**
 * Opens the endpoint the way a browser's EventSource does: over a request the
 * client can abort. The abort signal is the *only* channel that reaches the
 * server-side generator — cancelling the response reader does not — so a
 * request opened without one leaves the stream subscribed to the process-wide
 * hub after the test ends. That leak keeps the change-feed relay polling the
 * ambient `db` handle, which the harness nulls between tests, so the relay
 * silently falls back to the developer's real database and fans its rows into
 * whichever stream a later test has open. Every caller must therefore call
 * `disconnect` when it is done — {@link readStreamText} does so for you.
 */
async function openEventStream(
  url: string,
  headers: Record<string, string>,
): Promise<{ response: Response; disconnect: () => void }> {
  const controller = new AbortController();
  const response = await app.handle(
    new Request(url, { headers, signal: controller.signal }),
  );
  return { response, disconnect: () => controller.abort() };
}

/** Waits (briefly) for the hub to drop back to `expected` subscribers, so the
 * assertion does not depend on how many microtasks teardown takes. */
async function waitForSubscriberCount(expected: number): Promise<number> {
  const deadline = Date.now() + 1000;
  while (
    changeFeedHub().subscriberCount !== expected &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return changeFeedHub().subscriberCount;
}

async function readStreamText(
  response: Response,
  {
    untilIncludes,
    timeoutMs,
    disconnect,
  }: {
    untilIncludes: string[];
    timeoutMs: number;
    disconnect: () => void;
  },
): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const result = await Promise.race([
        reader.read(),
        new Promise<"timeout">((resolve) =>
          setTimeout(() => resolve("timeout"), deadline - Date.now()),
        ),
      ]);
      if (result === "timeout" || result.done) {
        break;
      }
      // Elysia's SSE body yields already-serialized string frames at runtime,
      // though the stream is typed as bytes; decode byte chunks for robustness.
      const value: unknown = result.value;
      text +=
        typeof value === "string"
          ? value
          : decoder.decode(value as Uint8Array, { stream: true });
      if (untilIncludes.every((needle) => text.includes(needle))) {
        break;
      }
    }
  } finally {
    disconnect();
    await reader.cancel().catch(() => {});
  }
  return text;
}

describe("GET /events", () => {
  it("streams the ready frame and replays a matching change for the channel", async () => {
    await dbc.insert(schema.changeFeed).values({
      id: 1n,
      sourceTable: "market_created_events",
      op: "insert",
      chainId: 31337,
      marketId: "42",
    });

    const { response, disconnect } = await openEventStream(
      "http://localhost/events?channels=markets",
      // Explicit Last-Event-ID 0 forces a replay from the start; a cursorless
      // client would instead resume from the tip (covered below).
      { accept: "text/event-stream", "last-event-id": "0" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") ?? "").toContain(
      "text/event-stream",
    );

    const text = await readStreamText(response, {
      untilIncludes: ["event: ready", "event: change"],
      timeoutMs: 2000,
      disconnect,
    });

    expect(text).toContain("event: ready");
    expect(text).toContain("event: change");
    // The change frame carries the cursor id (for Last-Event-ID) and routing.
    expect(text).toContain("id: 1");
    expect(text).toContain("market_created_events");
  });

  it("resumes a cursorless client from the tip, not replaying history", async () => {
    await dbc.insert(schema.changeFeed).values({
      id: 1n,
      sourceTable: "market_created_events",
      op: "insert",
      chainId: 31337,
      marketId: "42",
    });

    const { response, disconnect } = await openEventStream(
      "http://localhost/events?channels=markets",
      { accept: "text/event-stream" }, // no Last-Event-ID
    );

    const text = await readStreamText(response, {
      untilIncludes: ["never-appears"],
      timeoutMs: 400,
      disconnect,
    });
    expect(text).toContain("event: ready");
    expect(text).not.toContain("event: change");
  });

  it("opens an empty stream when no channels are requested", async () => {
    const { response, disconnect } = await openEventStream(
      "http://localhost/events",
      { accept: "text/event-stream" },
    );

    expect(response.status).toBe(200);
    const text = await readStreamText(response, {
      untilIncludes: ["event: ready"],
      timeoutMs: 2000,
      disconnect,
    });
    expect(text).toContain("event: ready");
  });

  // Regression guard: a stream that outlives its test keeps the change-feed
  // relay polling, and the relay polls the ambient `db` handle — which this
  // file nulls between tests, so a leaked subscription makes the unit suite
  // read the developer's real database and deliver its rows into a later
  // test's stream. That is what made the cursorless-resume test above flaky.
  it("releases its hub subscription when the client disconnects", async () => {
    expect(await waitForSubscriberCount(0)).toBe(0);

    const { response, disconnect } = await openEventStream(
      "http://localhost/events?channels=markets",
      { accept: "text/event-stream" },
    );
    const reader = response.body!.getReader();
    await reader.read(); // the `ready` frame; the stream is now subscribed
    expect(changeFeedHub().subscriberCount).toBe(1);

    disconnect();
    expect(await waitForSubscriberCount(0)).toBe(0);
    await reader.cancel().catch(() => {});
  });
});
