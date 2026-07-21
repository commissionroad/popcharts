---
type: summary
title: ADR 0022 — Resolution Dispute Program (docs/adr/0022-resolution-dispute-program.md)
description: PROPOSED cross-stack program landing protocol ADR 0013's dispute window — phased protocol/indexer/runner+keeper/API+UI/ops checklist, superseding ADR 0012's off-chain operator delay; every resolution waits one public 24h window before redemption.
sources:
  - docs/adr/0022-resolution-dispute-program.md
updated: 2026-07-20
---

# ADR 0022 — Resolution Dispute Program

PROPOSED 2026-07-20 (all boxes open). The program ADR for
[protocol ADR 0013's mechanism](protocol-adr-0013-bonded-optimistic-resolution.md):
propose → bonded 24h public dispute → permissionless finalize.

## Phases

**0 — decisions (user):** protocol ADR 0013's open questions (bond sizing,
forfeit sink, bounty, re-proposal). **1 — protocol (keystone,
human-reviewed):** market-contract status machine + bonds + events, adapter
plumbing for per-market window/bond, full test matrix, ABI/fixture
regeneration. **2 — indexer:** raw tables + watchers for the proposal/
dispute/bond events (money paper-trail invariant), `markets.status` gains
`resolution_pending`/`disputed`, change-feed wiring
([ADR 0021](root-adr-0021-live-market-updates.md)). **3 — runner + keeper:**
runner submits `proposeResolution` immediately (off-chain delay superseded),
keeper finalizes past-window markets idempotently, lifecycle-harness
scenarios (ADR 0017 C3). **4 — API + app:** pending/disputed reads with
countdown, wallet-signed dispute button with bond approve+post, operator
self-dispute/settle in local admin tooling only; extends
[ADR 0018's terminal surfaces](root-adr-0018-terminal-market-surface-and-redemption-ux.md)
with the two new non-Trading states. **5 — ops:** page on
`ResolutionDisputed`, ADR 0012 checkbox handoff, wiki ingest.

## Consequences

Redemption opens one window after the verdict on every market (UX must make
pending legible); one new keeper duty; two new watchers; a second user-side
value transfer (the bond) joins the paper-trail invariant from day one.

## Related pages

- [Protocol ADR 0013 — the mechanism](protocol-adr-0013-bonded-optimistic-resolution.md)
- [ADR 0012 — AI-assisted resolution](root-adr-0012-ai-assisted-resolution.md) (its 24h off-chain delay is superseded)
- [ADR 0019 — verdict quality program](root-adr-0019-ai-verdict-quality-program.md) (the measured fallibility motivating this)
- [ADR 0018 — terminal market surfaces](root-adr-0018-terminal-market-surface-and-redemption-ux.md)
