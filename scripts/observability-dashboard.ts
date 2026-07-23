#!/usr/bin/env -S node --experimental-strip-types

// Serves a local, live testing-observability dashboard (ADR 0017): it reads the
// ci-metrics datastore straight from `origin/ci-metrics` and renders coverage
// trends and nightly-lifecycle outcomes. Local-only by design — no hosting, no
// exposure of internal metrics — so run it whenever you want the current
// picture: `pnpm run observability` (or `just observability`).
//
// The page polls /api/observability; each read git-fetches ci-metrics (cached
// briefly) so the dashboard tracks whatever CI has pushed.

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

// Cache the snapshot so many polling tabs don't each trigger a git fetch; the
// data changes at CI cadence (minutes), so a 15s floor is plenty fresh.
let cached: { at: number; snapshot: ObservabilitySnapshot } | null = null;

function snapshot(): ObservabilitySnapshot {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.snapshot;
  const fresh = readCiMetrics(repoRoot);
  cached = { at: now, snapshot: fresh };
  return fresh;
}

const server = createServer((req, res) => {
  if (req.url === "/api/observability") {
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(snapshot()));
    return;
  }
  if (req.url === "/" || req.url === "/index.html") {
    // Read the page from disk per request so edits show on a plain refresh.
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(readFileSync(pagePath, "utf8"));
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`Testing observability dashboard: http://localhost:${PORT}`);
  console.log("Reads origin/ci-metrics live. Ctrl-C to stop.");
});
