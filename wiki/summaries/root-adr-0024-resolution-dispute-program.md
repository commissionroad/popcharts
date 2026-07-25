---
type: summary
title: ADR 0024 — Resolution Dispute Program (docs/adr/0024-resolution-dispute-program.md)
description: ACCEPTED cross-stack program landing protocol ADR 0013's dispute window — phased protocol/indexer/runner+keeper/API+UI/ops checklist, superseding ADR 0012's off-chain operator delay; every resolution waits one public 24h window before redemption. Phase 1 (contracts) and the public resolution-check endpoint landed 2026-07-24; Phases 2-5 otherwise open.
sources:
  - docs/adr/0024-resolution-dispute-program.md
updated: 2026-07-24
---

# ADR 0024 — Resolution Dispute Program

ACCEPTED (Phase 0 locked 2026-07-23: flat ~100-unit bond, forfeits to owner,
no bounty, operator finality. **Phase 1 landed 2026-07-24** — PRs #328
propose/finalize and #321 dispute/bond/settlement — along with Phase 4's
public resolution-check endpoint, PR #342; Phases 2, 3, 5 and the rest of 4
open). The program ADR for
[protocol ADR 0013's mechanism](protocol-adr-0013-bonded-optimistic-resolution.md):
propose → bonded 24h public dispute → permissionless finalize.

## Phases

**0 — decisions: DONE** (flat bond ~100 units set via prepareMarket, forfeit→owner, no bounty v1, operator finality v1). **1 — protocol (keystone,
human-reviewed): DONE 2026-07-24** — market-contract status machine + bonds +
events, adapter plumbing for per-market window/bond, full test matrix,
ABI/fixture regeneration. Local deploy seams pin window and bond to zero
(`protocol/scripts/shared/deployment/localDisputeConfig.ts`), which keeps the
legacy direct-`resolve()` path alive until Phase 3 switches the runner over.
**2 — indexer:** raw tables + watchers for the proposal/
dispute/bond events (money paper-trail invariant), `markets.status` gains
`resolution_pending`/`disputed`, change-feed wiring
([ADR 0021](root-adr-0021-live-market-updates.md)). **3 — runner + keeper:**
runner submits `proposeResolution` immediately (off-chain delay superseded),
keeper finalizes past-window markets idempotently, lifecycle-harness
scenarios (ADR 0017 C3). **4 — API + app:** permissionless
resolution-check endpoint **(landed 2026-07-24, PR #342** — per-market 24h
cooldown, a request only spends an AI query; quorums/bounties rejected,
position-weighted triage + cheap pre-screen deferred), pending/disputed reads with
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
