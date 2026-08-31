# ADR 0028: Recurring Crypto Price Markets

Status: Proposed

Date: 2026-08-31

## Context

The public board is empty between the markets people happen to create. A
visitor who arrives at a quiet moment sees an exchange with nothing trading,
which reads as broken rather than early. The product needs a class of market
that is always there, always resolving, and always obviously correct.

Short-horizon crypto price markets are the natural fit: *will the price of BTC
be higher or lower than it is now, at a fixed time from now?* The question is
binary, the resolution criteria are complete before the market opens, and the
answer is a comparison of two numbers from a public source. Nothing about the
outcome requires judgment.

That last property is the point. Every other market on the board resolves
through an AI verdict whose fallibility is measured
([ADR 0019](0019-ai-verdict-quality-program.md)) and guarded by a bonded
dispute window ([ADR 0024](0024-resolution-dispute-program.md)). A price market
resolves by arithmetic. Making it wait 24 hours for a challenge nobody can
substantively make is 288 times the market's own lifespan spent on ceremony.

## Decision

Run recurring price markets as ordinary Pop Charts markets with two additions:
a factory that creates them on a schedule, and a deterministic resolution
provider. They settle with a zero dispute window, which requires
[protocol ADR 0015](../../protocol/docs/adr/0015-per-market-dispute-window.md).

### 1. They use the normal resolution runner

This is the central decision and it went the other way first, so the reasoning
is worth recording. The tempting design gives price markets their own path —
their own resolver, bypassing the runner, because the runner is "the AI thing."

That is wrong. The runner is not the AI; it is the leasing, the retry policy,
the durable-intent outbox ([ADR 0026](0026-durable-resolution-intent.md)), the
pre-signing validation and re-check of the service response, the append-only
`market_resolutions` audit row, and the per-run telemetry
([ADR 0027](0027-verdict-quality-loop.md) A3). A separate path would rebuild
all of it worse, and a market that settles money without a receipt-linked audit
row violates the money paper trail in `AGENTS.md`.

The service already supports this. `resolver.ts` selects the provider as
`request.options?.provider ?? config.provider`, so the provider is overridable
**per request**, and `heuristicProvider` is already a non-LLM entry in the
registry. A price provider is the same shape.

- **`price-feed` joins the provider registry.** `canRunOffline: true`,
  `requiresApiKey: false`, `requiresPreCollectedEvidence: false`. The registry
  is `satisfies Record<ResolutionModelProviderName, ResolutionProvider>`, so
  adding the name forces the entry.
- **The runner selects it per market**, from a market-kind marker the factory
  sets at creation. Everything else about the runner is untouched.
- **`bypassAiResolution` stays out of this.** These markets do not bypass
  resolution; they use a deterministic evaluator inside it. The flag's open
  semantics ([ADR 0008](0008-protocol-functionality-completion.md),
  [ADR 0012](0012-ai-assisted-resolution.md)) are a separate question and this
  ADR does not touch them.

### 2. The price source is off-chain, and no on-chain oracle is needed

Resolution is decided off-chain and submitted by the resolver key. Nothing
on-chain reads a price, so this ADR introduces **no oracle contract, no
price-feed integration in Solidity, and no new key**. `resolve()` and
`proposeResolution()` are both `onlyResolver`, which the runner already holds.

The provider's obligation is that its verdict is **re-derivable**. Its evidence
must record the source, the exact instrument, both timestamps, and both prices,
so anyone reading the `market_resolutions` row can recompute the comparison and
get the same answer. A verdict that cannot be recomputed from its own audit row
is not deterministic, whatever produced it.

Source selection, staleness bounds, and what the provider does when the source
is unreachable at the resolution instant are left to implementation, with one
rule fixed here: **an unavailable or ambiguous price parks the market for a
human. It never guesses.** The existing `manual_review` path already does this.

### 3. Settlement: zero dispute window

Price markets are created with `disputeWindow = 0`, which protocol ADR 0015
makes a per-market creation parameter available to trusted creators. The
factory account is a trusted creator.

No runner or keeper change is needed. With a zero window, `dispute()` reverts
`DisputeWindowClosed` unconditionally, and `finalizeResolution()` is callable
in the same block the proposal lands. The runner's existing
`proposeResolution` call and the keeper's finalize duty settle the market
within one keeper tick.

A one-transaction variant exists — `resolve(side)` keeps a documented
single-step path from `Trading` at zero window — and would save that tick at
the cost of a branch in the runner. **Ship the zero-change version first.**
Whether the tick is too slow is measurable, and should be measured rather than
predicted.

### 4. The factory

A scheduled duty creates each market, hosted in the keeper beside the existing
clearing and finalize duties (`keeper/scheduler.ts` already provides
single-flight scheduling). It creates through the normal authorized-creation
path from a trusted-creator account, so these markets are ordinary rows in
`markets` and ordinary cards on the board — not a parallel type the rest of the
stack has to learn.

Question text and resolution criteria come from a fixed template per
instrument, generated rather than authored, and the template is versioned in
the repo so a change is a reviewable diff.

### 5. Cadence is a target, not a constraint — start slower

**This is the part most likely to break, and it is a lifecycle problem rather
than a pricing one.** A postgrad market cannot be created directly:
`CompleteSetPostgradAdapter.prepareMarket` is `onlyPregradManager`, so every
market is born pregrad and reaches the venue only by *graduating*. A market's
life is therefore: creation → pregrad receipts → `graduationDeadline` → keeper
notices → band-pass clearing and settlement → postgrad trading →
`resolutionTime` → proposal → finalize.

Inside a five-minute budget that is tight in two independent ways:

- **Fixed overhead.** The keeper's default tick is 30s
  (`POPCHARTS_KEEPER_INTERVAL_MS`), and the path crosses it at least twice —
  once to graduate, once to finalize — before counting the resolution runner's
  own cadence or two on-chain settlement sequences.
- **Graduation is not guaranteed.** A market that does not reach
  `graduationThreshold` in matched cap by its deadline refunds instead of
  graduating. For a market created every five minutes, that means the
  market-maker agents of [ADR 0029](0029-market-maker-agents.md) must fill both
  sides reliably, every time, or the board fills with refunded markets — which
  looks worse than an empty board. **ADR 0028 therefore depends on ADR 0029
  being reliable, not merely present**, and that dependency runs the opposite
  way to the order they were written.

The decision: **prove the full lifecycle end to end at a relaxed cadence
first** — a horizon comfortably clear of the overhead, measured on a local
stack — and tighten toward five minutes with the measurement in hand. The
five-minute figure is the goal; it is not an input the design is allowed to
assume.

### 6. Scope

Testnet only, and this ADR is superseded rather than extended when a mainnet
plan exists. Recurring markets whose liquidity comes from our own agents are a
demonstration, not a product line.

## Progress

- [ ] **P1 — Price provider.** `price-feed` in the resolution provider
      registry, with re-derivable evidence (source, instrument, both
      timestamps, both prices) and a `manual_review` park on unavailable or
      ambiguous prices. Unit tests over the comparison and the park paths.
- [ ] **P2 — Market kind marker.** A stored marker distinguishing price
      markets, set at creation and read by the runner to select the provider.
      One column, one enum value, no parallel table.
- [ ] **P3 — Question templates.** Versioned per-instrument templates for
      question text and resolution criteria, generated at creation.
- [ ] **P4 — Scheduled factory.** A keeper duty creating markets on a
      schedule from a trusted-creator account, at the relaxed cadence of §5.
      DEPENDS: protocol ADR 0015 (`disputeWindow = 0` at creation).
- [ ] **P5 — Lifecycle proof at the relaxed cadence.** A lifecycle scenario
      covering create → graduate → trade → resolve → finalize for one price
      market, with the wall-clock of each stage recorded in the PR.
- [ ] **P6 — Tighten the cadence.** Reduce toward five minutes using P5's
      measurements. Stop where the lifecycle stops being reliable and record
      the number reached.

## Exit criteria

A price market is created on schedule, graduates, trades, and resolves from a
re-derivable price comparison with no human in the loop and no dispute window,
and the board is never empty. The cadence actually achieved is written into
this ADR, whether or not it is five minutes.

## Consequences

Positive:

- A permanently active board whose most visible markets are also its most
  obviously correct.
- The first production use of a deterministic resolution provider, which is a
  useful control case against the AI providers the eval suite measures.
- Settlement latency becomes a measured number rather than an assumption.

Tradeoffs:

- A standing dependency on an external price source we do not control, whose
  outage parks markets rather than resolving them.
- Zero-window markets have no recourse if the provider is wrong. That is
  acceptable exactly because the verdict is re-derivable from its audit row —
  and it is why §2's re-derivability requirement is a constraint rather than a
  nicety.
- These markets will dominate board volume, and their volume is synthetic
  (ADR 0029). Every aggregate statistic on the site becomes a statement about
  our own agents unless it separates them out.

## Related

- Protocol ADR 0015 — per-market dispute windows; strictly required by §3.
- ADR 0029 — the market-maker agents §5 depends on for graduation.
- ADR 0024 — the dispute mechanism these markets opt out of.
- ADR 0026 — the durable resolution intent the runner keeps for them.
- ADR 0012 — the resolution service whose provider registry §1 extends.
