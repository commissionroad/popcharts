# ADR 0029: Recurring Crypto Price Markets

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
single-flight scheduling). It creates through the direct-postgrad path of §5
from an authorized factory account.

Downstream of creation these are **ordinary markets** — ordinary rows in
`markets`, ordinary cards on the board, ordinary postgrad trading and
resolution. The only thing the rest of the stack learns is that a postgrad
market may have no pregrad history, which §5 records as a real cost.

Question text and resolution criteria come from a fixed template per
instrument, generated rather than authored, and the template is versioned in
the repo so a change is a reviewable diff.

### 5. These markets are born postgrad

A price market has no use for a pregrad phase. Pregrad exists to discover a
price and a size from real demand before a venue is committed; a
"higher or lower than right now" market opens at 50/50 by construction and
knows its size from its template. Running it through receipts, a graduation
deadline and band-pass clearing buys nothing and costs the market most of its
life.

**Nothing about the design blocks this — the obstacle is an access modifier
and a funding source.** `CompleteSetPostgradAdapter.prepareMarket` is
`onlyPregradManager` today, and reading its call site shows exactly what
graduation supplies that a direct path would not:

```solidity
prepareMarket(marketId, collateral, metadataHash,
              clearingRoot.retainedCostTotal,   // collateral to back the market
              clearingRoot.completeSetCount,    // complete sets to mint
              market.config.yesNotBefore, market.config.resolutionTime)
```

Two values, both money-shaped: an amount of collateral transferred in, and a
complete-set count the adapter checks against the capacity it returns.
Everything else — collateral address, metadata hash, the time gates — is
creation config the factory already holds. Graduation is not computing
something the adapter needs; it is *paying* for the market. So a direct path
needs a funder, not a redesign.

**Decision: add a permissioned direct-create entry point to the postgrad
adapter**, callable by an authorized factory account, that accepts collateral
from the caller, mints the matching complete sets against it, and deploys the
market — subject to the same conservation checks `prepareMarket` enforces
today. Price markets are created through it and never touch `PregradManager`.

This is a **fund-holding contract change**, so it is Track C under
[ADR 0016](0016-monorepo-architecture-cleanup-program.md): human review
required, not merged autonomously. It needs its own protocol ADR before code,
and this ADR does not stand in for one.

What it buys:

- **The lifecycle collapses to create → trade → resolve.** No graduation
  deadline, no clearing, no settlement sequence, and one fewer keeper tick.
  Five minutes stops being arithmetically doubtful.
- **The refund failure mode disappears.** A market that never has to reach
  `graduationThreshold` can never refund for missing it, so a bad fill window
  costs depth rather than the market's existence.
- **The dependency on ADR 0030 weakens to the right strength.** The agents are
  no longer load-bearing for these markets *existing* — only for their having
  depth. That is a quality problem, not an outage.

What it costs, stated plainly:

- **A new privileged path that mints complete sets against supplied
  collateral** is the highest-consequence surface in this ADR by a wide
  margin. It must reuse `prepareMarket`'s conservation checks rather than
  reimplement them, and the authorized-factory credential must be narrow — see
  §6.
- **No pregrad phase means no review gate from receipts.** Whether these
  markets go through draft review ([ADR 0022](0022-review-first-market-creation.md))
  or are exempt as generated-from-template is a decision the protocol ADR must
  make explicitly. Generated text from a versioned template is the argument for
  exemption; "an unreviewed creation path exists" is the argument against.
- **A second way markets come into being** is permanent complexity in the
  indexer, the API and the app, all of which currently assume every postgrad
  market has a pregrad history.

**Fallback, if the contract change is not wanted:** create these as ordinary
pregrad markets and have ADR 0030's agents fill both sides immediately so they
graduate on the keeper's next pass. This needs no protocol change, and it is
strictly worse — it keeps the refund failure mode, spends two keeper ticks
(default 30s each, `POPCHARTS_KEEPER_INTERVAL_MS`) plus two settlement
sequences inside the market's life, and makes ADR 0030's reliability a
precondition for ADR 0029 working at all.

**Either way, the cadence is measured before it is promised.** Five minutes is
the goal. P5 records the wall-clock each stage actually takes and P6 tightens
toward it; whatever number the lifecycle reliably supports is written back into
this ADR, five or not.

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
- [ ] **P4 — Direct-postgrad creation (protocol).** A permissioned entry
      point on `CompleteSetPostgradAdapter` that funds and deploys a market
      without `PregradManager`, reusing `prepareMarket`'s conservation checks.
      **Track C: fund-holding contract change, human review required, needs its
      own protocol ADR first.** DEPENDS: protocol ADR 0015 for
      `disputeWindow = 0`.
- [ ] **P5 — Scheduled factory.** A keeper duty creating markets on a schedule
      through P4's path from an authorized factory account.
- [ ] **P6 — Lifecycle proof.** A lifecycle scenario covering create → trade →
      resolve → finalize for one price market, with the wall-clock of each
      stage recorded in the PR.
- [ ] **P7 — Downstream tolerance.** Indexer, API and app handle a postgrad
      market with no pregrad history — no receipts, no clearing root, no
      graduation event — without falling back to an error state.
- [ ] **P8 — Set the cadence.** Tighten toward five minutes using P6's
      measurements. Stop where the lifecycle stops being reliable and write the
      number reached into this ADR.

## Exit criteria

A price market is created on schedule, trades, and resolves from a
re-derivable price comparison with no human in the loop and no dispute window,
and the board is never empty. The cadence actually achieved is written into
this ADR, whether or not it is five minutes.

## Consequences

Positive:

- A permanently active board whose most visible markets are also its most
  obviously correct.
- A postgrad market that can be created directly, which is reusable well beyond
  price markets — any market whose price and size are known up front no longer
  needs a pregrad phase to reach the venue.
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
  (ADR 0030). Every aggregate statistic on the site becomes a statement about
  our own agents unless it separates them out.

## Related

- Protocol ADR 0015 — per-market dispute windows; strictly required by §3.
- ADR 0030 — the market-maker agents that give these markets depth. With §5's
  direct-postgrad path they are no longer required for the markets to exist.
- ADR 0024 — the dispute mechanism these markets opt out of.
- ADR 0026 — the durable resolution intent the runner keeps for them.
- ADR 0012 — the resolution service whose provider registry §1 extends.
