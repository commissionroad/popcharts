---
type: summary
title: Repo ADR 0010 — Indexer maturity
description: Vertical ADR to bring the indexer to Arc-Testnet grade (reorg handling, confirmation depth, RPC failover, leasing, lag metrics) and index the postgrad lifecycle; all eight items open.
sources:
  - docs/adr/0010-indexer-maturity.md
updated: 2026-07-07
---

# Repo ADR 0010: Indexer Maturity

**Status: Accepted.** Dated 2026-07-06. Vertical checklist per ADR 0007
([summary](root-adr-0007-track-verticals-with-progress-adrs.md)).

## Context

The indexer watches all nine `PregradManager` event types with idempotent,
cursor-based recovery (dedupe on transaction hash + log index), so restarts
and downtime are already safe. The July 2026 audit identified what a public
network needs: no reorg detection (cursors track block numbers, not hashes), a
singleton process with no leasing, a single RPC URL with no failover, and no
coverage of postgrad venue events — graduated markets go dark to the database.

## Decision

Bring the indexer to Arc-Testnet grade and extend it over the postgrad
lifecycle. Running it anywhere is ADR 0015.

## Progress (all items unchecked as of 2026-07-07)

Chain robustness:

- [ ] Reorg handling: store block hashes alongside cursors, detect parent
  mismatches, rewind to the fork point, re-scan.
- [ ] Configurable confirmation depth before events are treated as final
  (local can stay at zero).
- [ ] RPC failover: accept a list of HTTP/WSS endpoints and rotate on failure.

Scaling:

- [ ] DB-backed leasing (Postgres advisory locks or lease rows) so multiple
  indexer tasks can run without double-processing.
- [ ] Expose cursor lag (chain head minus last processed block) as a queryable
  value for health checks and future alarms.

Postgrad coverage:

- [ ] Watchers and schema for `CompleteSetPostgradAdapter` and
  `CompleteSetBinaryMarket` events (market creation, mint/merge/redeem,
  resolution, cancellation).
- [ ] Watchers and schema for v4 venue trading events
  (`BoundedPoolOrderManager` order placement and fills) so postgrad prices and
  volume are servable.
- [ ] Resolution events feed the `markets` projection so status reaches
  `resolved` without manual intervention.

## Exit criteria

With two indexer instances running against a chain that experiences a forced
reorg (devchain snapshot/revert), the database converges to canonical history
with no duplicate or missing events, and a graduated market's postgrad trades
and resolution appear in the API without manual backfill.

## Consequences

Reorg rewind requires projection tables to stay rebuildable from raw event
tables — a property all future projection logic must preserve. Postgrad
watchers multiply the contract-address registry: adapters and markets are
created dynamically per graduation, so the registry must discover addresses
from `GraduationFinalized` rather than static config.

## Related pages

- [../entities/indexer.md](../entities/indexer.md)
- [../entities/server-workspace.md](../entities/server-workspace.md)
- [../entities/pregrad-manager.md](../entities/pregrad-manager.md)
- [../entities/postgrad-market.md](../entities/postgrad-market.md)
- [../entities/devchain.md](../entities/devchain.md)
- [../concepts/market-lifecycle.md](../concepts/market-lifecycle.md)
- [../concepts/complete-sets.md](../concepts/complete-sets.md)
