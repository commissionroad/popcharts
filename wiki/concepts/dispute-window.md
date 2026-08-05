---
type: concept
title: Resolution dispute window
description: The bonded optimistic settlement layer between a verdict and redemption — propose → 24h public dispute → permissionless finalize, with the resolver's bond-free self-dispute as the operator override that replaced ADR 0012's off-chain delay.
sources:
  - protocol/docs/adr/0013-bonded-optimistic-resolution-with-dispute-window.md
  - docs/adr/0024-resolution-dispute-program.md
  - docs/adr/0012-ai-assisted-resolution.md
  - docs/ai-resolution-service-design.md
  - docs/portfolio-data-design.md
  - infra/README.md
updated: 2026-08-04
---

# Resolution dispute window

**Status: accepted and substantially built.** Every graduated market's outcome
now passes through a public, bonded window before redemption opens. This page
synthesizes the mechanism ([protocol ADR 0013](../summaries/protocol-adr-0013-bonded-optimistic-resolution.md))
and the cross-stack program that lands it
([repo ADR 0024](../summaries/root-adr-0024-resolution-dispute-program.md)).

## Why it exists

[Root ADR 0019](../summaries/root-adr-0019-ai-verdict-quality-program.md)
measured the AI resolver's fallibility: verdicts are a run-to-run lottery on the
same content. Before this, `resolve(side)` was terminal the instant it landed,
and the only planned mitigation was an **off-chain operator delay**
(`RESOLUTION_DELAY_MS`, "24h on Arc, 0 on local") that participants could
neither see nor use.

That delay **was never built**. It was superseded on 2026-07-20, before any code
existed, for a structural reason worth keeping in view: an off-chain delay binds
only the runner, so a direct contract call bypasses it entirely, and it gives
recourse to nobody but the operator. The on-chain window binds *every* path to
settlement and lets market participants object.

## Mechanism

```
Trading ──proposeResolution(side)──▶ ResolutionPending ──finalizeResolution()──▶ Resolved
                (onlyResolver)              │            (permissionless, post-window)
                                            │
                                        dispute()  (bonded, public, single active)
                                            ▼
                                        Disputed ──resolve(side)──▶ Resolved
                                                 └─cancel()───────▶ Cancelled (draw)
```

- **Propose** keeps the per-side `yesNotBefore`/`noNotBefore` floors, so the
  temporal guardrails of
  [AI-assisted resolution](ai-assisted-resolution.md) still hold at the proposal
  step.
- **The window** is an immutable per-market `disputeWindow` — 24h on deployed
  networks, seconds-to-zero locally — set at graduation via `prepareMarket`.
  Finalization is permissionless and keeper-driven.
- **Dispute** freezes finalization for human adjudication. `resolve(side)` is
  no longer the entry point; it is now the *settlement* call, ungated from
  `Disputed`. `cancel()` remains the never-time-gated draw escape hatch,
  callable from any non-terminal status.
- **Redemption paths are unchanged** — the window sits in front of them.

## The bond

A flat per-market `disputeBond` in market collateral (~100 units, protocol-wide
in v1), configured at graduation. One active dispute at a time. It is
**refunded when the final outcome differs from the proposal** (the disputer was
right) and **forfeited to the protocol owner** otherwise; no disputer bounty in
v1. Bond custody is deliberately kept outside redemption solvency, so a bond can
never be paid out of the collateral backing [complete sets](complete-sets.md).

Every bond movement emits `DisputeBondPosted`/`Refunded`/`Forfeited` and lands
in `postgrad_dispute_bond_events` — the bond is a second user-side value
transfer and joins the money paper-trail invariant from day one (see
[portfolio data design](../summaries/portfolio-data-design.md)).

## The operator override

The resolver may **self-dispute bond-free**. That is the whole operator-override
path, and it is what replaced ADR 0012's off-chain delay: instead of withholding
a submission the operator disagrees with, the operator disputes a proposal that
is already public. Operator settlement is final in v1 (no arbitration backstop
yet — the richer optimistic pipeline in the superseded v0.1/v3 whitepapers goes
further; see [mechanism whitepaper](mechanism-whitepaper.md)).

## Positioning against clearing

This is the deliberate **contrast case** to
[protocol ADR 0010](../summaries/protocol-adr-0010-disable-the-clearing-challenge-window-by-default.md),
which disabled the *clearing* challenge window by default. The distinction is
what the claim depends on: graduation clearing is machine-checkable from
on-chain receipts, so a window buys nothing
([graduation clearing](graduation-clearing.md)); resolution depends on a
real-world fact that no contract can verify, so a window is the only check
available.

All dispute state is market-scoped, so it transfers unchanged onto the
[singleton position book](../summaries/protocol-adr-0012-singleton-postgrad-position-book.md).

## Where it lives in the stack

| Layer | Surface |
| --- | --- |
| Protocol | `CompleteSetBinaryMarket` status machine + bonds; `CompleteSetPostgradAdapter`/`prepareMarket` plumb window + bond |
| [Indexer](../entities/indexer.md) | `postgrad_dispute_events` + `postgrad_dispute_bond_events`; the postgrad-market watcher decodes the proposal/dispute/bond logs; `markets.status` gains `resolution_pending`/`disputed` |
| Runner | submits `proposeResolution(side)` immediately — no off-chain delay |
| [Clearing keeper](../entities/clearing-keeper.md) | a finalize-after-window duty discovers pending markets past their deadline and finalizes idempotently |
| API + app | permissionless resolution-request endpoint (per-market 24h cooldown); a market-detail dispute panel reading chain state, with a wallet-signed dispute button |
| [Ops](deployment-and-infrastructure.md) | a `ResolutionDisputed` alarm — a dispute is an operator page, not a metric |

## Related pages

- [AI-assisted resolution](ai-assisted-resolution.md) — the pipeline that proposes
- [Market lifecycle](market-lifecycle.md) — where the window sits end to end
- [Protocol ADR 0013](../summaries/protocol-adr-0013-bonded-optimistic-resolution.md) — the mechanism
- [Repo ADR 0024](../summaries/root-adr-0024-resolution-dispute-program.md) — the cross-stack program
- [Repo ADR 0018](../summaries/root-adr-0018-terminal-market-surface-and-redemption-ux.md) — the terminal surfaces the two new non-Trading states extend
