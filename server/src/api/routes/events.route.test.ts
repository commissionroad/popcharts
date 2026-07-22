// Observes the SSE endpoint over the real Elysia handler (repo ADR 0021): that
// `GET /events` opens a text/event-stream, sends the `ready` frame, and replays
// a matching change_feed row for the subscribed channel from Last-Event-ID 0.
// The stream's dedup/heartbeat/gap logic is unit-tested in change-feed-stream;
// this proves the HTTP wiring around it.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { app } from "src/api/index";
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

async function readStreamText(
  response: Response,
  { untilIncludes, timeoutMs }: { untilIncludes: string[]; timeoutMs: number },
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

    const response = await app.handle(
      // Explicit Last-Event-ID 0 forces a replay from the start; a cursorless
      // client would instead resume from the tip (covered below).
      new Request("http://localhost/events?channels=markets", {
        headers: { accept: "text/event-stream", "last-event-id": "0" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") ?? "").toContain(
      "text/event-stream",
    );

    const text = await readStreamText(response, {
      untilIncludes: ["event: ready", "event: change"],
      timeoutMs: 2000,
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

    const response = await app.handle(
      new Request("http://localhost/events?channels=markets", {
        headers: { accept: "text/event-stream" }, // no Last-Event-ID
      }),
    );

    const text = await readStreamText(response, {
      untilIncludes: ["never-appears"],
      timeoutMs: 400,
    });
    expect(text).toContain("event: ready");
    expect(text).not.toContain("event: change");
  });

  it("opens an empty stream when no channels are requested", async () => {
    const response = await app.handle(
      new Request("http://localhost/events", {
        headers: { accept: "text/event-stream" },
      }),
    );

    expect(response.status).toBe(200);
    const text = await readStreamText(response, {
      untilIncludes: ["event: ready"],
      timeoutMs: 2000,
    });
    expect(text).toContain("event: ready");
  });
});
