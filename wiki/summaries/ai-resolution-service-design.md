---
type: summary
title: AI Resolution Service & Runner Design (docs/ai-resolution-service-design.md)
description: The design ADR 0012 required before build — a stateless resolution service + DB-leased runner that decides yes/no/draw/too_early from public evidence and submits resolve/cancel, built as a sibling of AI review, with per-outcome temporal gates and an on-chain floor guard.
sources:
  - docs/ai-resolution-service-design.md
updated: 2026-07-13
---

# AI Resolution Service & Runner Design

**Status: Accepted (2026-07-09).** This is the implementation design
[root ADR 0012](root-adr-0012-ai-assisted-resolution.md) requires. It decides
the outcome of a graduated [postgrad market](../entities/postgrad-market.md)
from public evidence and submits it on-chain — automatically for confident,
unambiguous cases, parked for a human otherwise. It is built as a **sibling of
[AI review](../entities/ai-review-service.md)**: wherever a choice is already
made in `server/src/ai-review*`, it is cloned rather than reinvented (see
[AI review runner design](ai-review-runner-design.md) for the mirrored shape).

## On-chain surface it targets

`CompleteSetBinaryMarket`: `resolve(Side)` and `cancel()` are both
`onlyResolver` and require `Status.Trading`; the resolver is a **single
immutable address** set on `CompleteSetPostgradAdapter` and passed to every
child market — one key resolves all postgrad markets from that adapter, exactly
analogous to the review-manager key (so custody is a solved shape). `cancel()`
is the draw path (YES and NO each redeem half).

## Temporal validity guardrails (the load-bearing addition)

A single `resolutionTime` is insufficient: fixed-event markets are only
knowable *after* the event; open-ended markets can confirm **YES** early but
**NO** only once the whole window elapses. The design replaces one deadline
with **two per-outcome gates**, each in its authoritative home:

- **`no_not_before`** (NO/draw gate) — **is** the existing on-chain
  `markets.resolution_time` (the `createMarket` arg, invariant
  `resolutionTime > graduationDeadline`). Not a new column.
- **`yes_not_before`** (early-YES gate) — a **genuinely new on-chain
  `createMarket` parameter**, carried in `MarketCreated`, plumbed through
  graduation into the child market as `earliestResolutionTime`, indexed into
  `markets.yes_not_before`. Defaults to `resolution_time` (no early YES).
  Invariant `graduationDeadline < yes_not_before ≤ resolutionTime`.
- **`observation_window_start/end`** — optional evidence-scoping *guidance*
  (not enforced), so it lives in the content-addressed metadata payload
  (**bumped to version 2**), tamper-evident and AI-validated.

Enforced in five layers, cheapest first: (1) creation + review reject markets
lacking clear expiry/source/criteria; (2) the runner's deterministic gate
refuses a YES before `yes_not_before` / a NO before `no_not_before` with no
model call; (3) a model `too_early` outcome re-queues with backoff, bounded so
an indefinitely-postponed event escalates to `manual_review`; (4) an **on-chain
per-outcome guard** — `resolve(side)` reverts `TooEarlyToResolve` before the
side's gate; this is the backstop that holds even if the resolver key is
compromised, and it closes ADR 0008's open on-chain-gating item; (5) the
operator delay/override window. `cancel()` is deliberately **not** time-gated
(postponement escape hatch).

## Verdict contract and safety gate

Outcomes `yes | no | draw | too_early | abstain` map to verdicts
`resolve_yes | resolve_no | cancel_draw | requeue_too_early | manual_review`. A
verdict becomes an **automatic** on-chain action only when `outcome ∈ {yes,no}`
**and** `confidence ≥ 0.85` **and** ≥1 corroborating evidence item survived the
parser. **Draws always park** for an operator (rare, high-blast-radius — both
sides redeem at half); `cancel()` is only ever issued via override/self-resolve.
`too_early` re-queues (neither failure nor resolution). Abstain / low-confidence
/ no-evidence park as `manual_review`, and a service/model error **fail-safe
downgrades to `manual_review`** — an outage never resolves a market.

## Architecture — cloned from AI review

New `server/src/ai-resolution/` (service) and `ai-resolution-runner/` (runner),
`POST /resolutions/market`, provider registry (`heuristic`/`ollama`/`anthropic`
via `satisfies`), untrusted-output `resolution-parsing.ts`, reused `safe-web.ts`,
append-only `market_resolutions` + leased `market_resolution_jobs` (same
`FOR UPDATE SKIP LOCKED` + partial-unique active-job index), guarded
`chain-resolution.ts` transition, distinct `readResolverPrivateKey`, and
`admin-resolution.ts`. The `resolution_provider` enum adds **`manual`** for
operator-override / self-resolve rows (why it is not a reuse of the review
provider enum).

**Divergence from review:** status propagation is **not** a guarded `markets`
UPDATE in the runner — because a market can also reach `Resolved`/`Cancelled`
via operator override or trusted-creator self-resolve, the **indexer** is the
canonical projector (a new `MarketResolved`/`MarketCancelled` watcher flips
`markets.status → resolved`, ADR 0010's open item). The runner writes the
verdict/audit; the chain event is the source of truth for status.

## Decisions resolved 2026-07-09

1. Abstention threshold **0.85** + ≥1 surviving evidence item.
2. Operator delay window **24h on Arc Testnet, 0 on local** (implemented via the
   queue's `run_after`: persist the audit, re-queue the *submission* step).
3. **Draws always manual** — never auto-cancel.
4. **Trusted-creator self-resolve is in the first build**, behind a cloned
   env-flag auth seam (`POPCHARTS_ADMIN_RESOLUTION_ENABLED`, injectable
   `resolutionAdminEnabled()`), swappable to shared operator auth when it lands.
5. **Temporal guardrails adopted with on-chain gates** (per-outcome, above).

`bypassAiResolution` (only a trusted creator can set it, at creation) gains its
resolution-time meaning here: `true` → not auto-discovered, resolved through the
operator-authenticated self-resolve endpoint (audited as `provider = 'manual'`);
`false` → must go through the AI service + delay window. Either way the resolver
key stays on the operator side.

## Implementation slices (map to the ADR 0012 checklist)

0. **On-chain window + per-outcome guard** (protocol, **human-reviewed** — funds-holding contract). 1. Schema. 2. Creation + review guardrails (payload v2, `yesNotBefore` wiring). 3. Service. 4. Runner. 5. Indexer watcher. 6. Operator override + self-resolve. 7. Orchestration + smoke + E2E extension. Critical path 1 → 3 → 4, provable against seeded temporal metadata ahead of slice 2.

## Related pages

- [AI-assisted resolution](../concepts/ai-assisted-resolution.md) — the concept this design fills in
- [Repo ADR 0012](root-adr-0012-ai-assisted-resolution.md) — the vertical it implements
- [AI review runner design](ai-review-runner-design.md) — the architecture it mirrors
- [Repo ADR 0008](root-adr-0008-protocol-functionality-completion.md) — resolver entry points / the on-chain gate it closes
- [Server workspace](../entities/server-workspace.md) — hosts the service and runner
