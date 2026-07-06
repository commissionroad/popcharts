# ADR 0010: Indexer Maturity

Status: Accepted

Date: 2026-07-06

## Context

The indexer watches all nine `PregradManager` event types with idempotent,
cursor-based recovery (dedupe on transaction hash + log index), so restarts
and downtime are already safe. The July 2026 audit identified what is missing
for a public network: no reorg detection (cursors track block numbers, not
hashes), a singleton process with no leasing, a single RPC URL with no
failover, and no coverage of postgrad venue events — graduated markets go
dark to the database.

## Decision

Bring the indexer to Arc-Testnet grade and extend it over the postgrad
lifecycle. Running it anywhere is ADR 0015.

## Progress

Chain robustness:

- [ ] Reorg handling: store block hashes alongside cursors, detect parent
      mismatches, rewind to the fork point, and re-scan.
- [ ] Configurable confirmation depth before events are treated as final
      (local can stay at zero).
- [ ] RPC failover: accept a list of HTTP/WSS endpoints and rotate on
      failure.

Scaling:

- [ ] DB-backed leasing (Postgres advisory locks or lease rows) so more than
      one indexer task can run without double-processing.
- [ ] Expose cursor lag (chain head minus last processed block) as a
      queryable value for health checks and future alarms.

Postgrad coverage:

- [ ] Watchers and schema for `CompleteSetPostgradAdapter` and
      `CompleteSetBinaryMarket` events (market creation, mint/merge/redeem,
      resolution, cancellation).
- [ ] Watchers and schema for v4 venue trading events
      (`BoundedPoolOrderManager` order placement and fills) so postgrad
      prices and volume are servable.
- [ ] Resolution events feed the `markets` projection so status reaches
      `resolved` without manual intervention.

## Exit Criteria

With two indexer instances running against a chain that experiences a forced
reorg (devchain snapshot/revert), the database converges to the canonical
history with no duplicate or missing events, and a graduated market's
postgrad trades and resolution appear in the API without manual backfill.

## Consequences

- Reorg rewind means projection tables must be rebuildable from raw event
  tables; any future projection logic must preserve that property.
- Postgrad watchers multiply the contract-address registry: adapters and
  markets are created dynamically per graduation, so the registry must
  discover addresses from `GraduationFinalized` rather than static config.
