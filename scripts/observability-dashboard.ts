#!/usr/bin/env -S node --experimental-strip-types

// Serves a local, live testing-observability dashboard (ADR 0017): it reads the
// ci-metrics datastore straight from `origin/ci-metrics` and renders coverage
// trends and nightly-lifecycle outcomes. Local-only by design — no hosting, no
// exposure of internal metrics — so run it whenever you want the current
// picture: `pnpm run observability` (or `just observability`).
//
// The page polls /api/observability; the server refreshes from ci-metrics in
// the background (stale-while-revalidate) so the dashboard tracks what CI has
// pushed without a git call ever blocking a request.

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readCiMetrics,
  type ObservabilitySnapshot,
} from "./shared/observability/readCiMetrics.ts";
import { repoRoot } from "./shared/paths.ts";

const PORT = Number(process.env.OBSERVABILITY_PORT ?? 4700);
const CACHE_TTL_MS = 15_000;
const here = dirname(fileURLToPath(import.meta.url));
const pagePath = join(here, "shared", "observability", "dashboard.html");

// Stale-while-revalidate cache. `readCiMetrics` is async and git-timeout-bound,
// so it never blocks the event loop; on top of that, once any snapshot exists a
// request returns it instantly and the refresh runs in the background. Only the
// very first request awaits — and even that is bounded by the git timeout and
// falls back to the last-known ref. The dashboard can never hang on git again.
let cached: { at: number; snapshot: ObservabilitySnapshot } | null = null;
let inflight: Promise<ObservabilitySnapshot> | null = null;

function refresh(): Promise<ObservabilitySnapshot> {
  if (!inflight) {
    inflight = readCiMetrics(repoRoot)
      .then((fresh) => {
        cached = { at: Date.now(), snapshot: fresh };
        return fresh;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

async function snapshot(): Promise<ObservabilitySnapshot> {
  const fresh = cached && Date.now() - cached.at < CACHE_TTL_MS;
  if (fresh) return cached!.snapshot;
  const pending = refresh();
  if (cached) {
    // Serving stale: the background refresh has no awaiter here, so swallow any
    // unexpected rejection or it becomes an unhandled rejection that can
    // terminate the process. (Expected git/parse failures already resolve.)
    pending.catch(() => {});
    return cached.snapshot;
  }
  // First-ever load: awaited by the handler, which catches and returns 503.
  return pending;
}

const server = createServer(async (req, res) => {
  if (req.url === "/api/observability") {
    try {
      const snap = await snapshot();
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(snap));
    } catch (error) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `ci-metrics read failed: ${String(error)}` }));
    }
    return;
  }
  if (req.url === "/" || req.url === "/index.html") {
    // Read the page from disk per request so edits show on a plain refresh.
    // Read before writing the status so a missing/unreadable asset returns 500
    // rather than throwing out of the callback and killing the server.
    let page: string;
    try {
      page = readFileSync(pagePath, "utf8");
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(`dashboard page not found at ${pagePath}: ${String(error)}`);
      return;
    }
    // `no-store`: this shell is a live dashboard, and a browser that caches it
    // will keep serving an old page (with old client JS) across restarts — which
    // is exactly how a fixed dashboard still looked broken until a hard reload.
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, must-revalidate",
    });
    res.end(page);
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use — another dashboard may be running. Set OBSERVABILITY_PORT to pick a different one.`,
    );
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, () => {
  console.log(`Testing observability dashboard: http://localhost:${PORT}`);
  console.log("Reads origin/ci-metrics live. Ctrl-C to stop.");
});
