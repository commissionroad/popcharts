# ADR 0013: Bonded Optimistic Resolution With A Public Dispute Window

## Status

Accepted (Phase 0 decisions locked 2026-07-23)

## Context

Postgrad resolution today is single-shot and trustless only in its timing
gates: `CompleteSetBinaryMarket.resolve(side)` is `onlyResolver`, requires
`Status.Trading`, enforces the per-side `yesNotBefore`/`noNotBefore` floors,
and immediately makes the market terminal — winning tokens redeem, the losing
side is worthless. `cancel()` (draw) is the only escape hatch and is also
`onlyResolver`. Token holders have no on-chain voice: a wrong resolution is
final the moment the resolver's transaction lands.

That resolver is the AI resolution pipeline (repo ADR 0012, built and
measured under repo ADR 0019). The measured reality is that the resolver
will sometimes be wrong — the eval suite has produced wrong-direction
verdicts from criteria-literalism failures — and the deployed design
acknowledges this with an _off-chain_ operator delay window (24h between
verdict and submission). An off-chain delay protects only against failure
modes the operator notices; it gives market participants — the people with
both the strongest incentive and often the best information — no mechanism
to halt a wrong resolution.

Two sibling decisions frame the design:

- **ADR 0010** disabled the _graduation clearing_ challenge window by
  default because clearing correctness is machine-checkable and the keeper
  is trusted. Resolution is different in kind: correctness depends on
  real-world facts no deterministic checker can verify, so the case against
  a challenge window there is the case _for_ one here.
- **ADR 0012** (singleton position book, Proposed) moves resolution,
  cancellation, and the time gates into `marketId`-keyed state on
  `PostgradPositionBook` for the mainnet path. Any dispute mechanism must
  therefore be **market-scoped state, not contract-scoped**, so it transfers
  to the book unchanged.

## Decision

Replace single-shot resolution with a three-step optimistic flow, keyed per
market, with a bonded public dispute during a fixed window.

### Status machine

```
Trading ──proposeResolution(side)──▶ ResolutionPending
   │                                   │        │
   │                              dispute()  finalizeResolution()
   │                                   │        │  (after window,
   │                                   ▼        ▼   permissionless)
   │                               Disputed   Resolved
   │                                   │
   │                          resolve(side) [resolver]
   │                                   ▼
   └──cancel() [resolver, from any     Resolved
      non-terminal status]──▶ Cancelled
```

- **`proposeResolution(side)`** — `onlyResolver`, requires `Trading`,
  enforces the existing per-side `yesNotBefore`/`noNotBefore` floors.
  Records `proposedSide` and `proposedAt`, emits
  `ResolutionProposed(side, disputeDeadline)`. Trading, minting, merging,
  and retained-claim flows continue unchanged while pending — the market is
  not terminal yet.
- **`finalizeResolution()`** — permissionless, requires `ResolutionPending`
  and `block.timestamp >= proposedAt + disputeWindow`. Sets the winning
  side, moves to `Resolved`, emits the existing `MarketResolved(side)`.
  The keeper drives this in practice; permissionlessness is the safety
  valve if the keeper dies.
- **`dispute()`** — callable by anyone while `ResolutionPending` and inside
  the window. Transfers `disputeBond` of the market's collateral from the
  caller, records the disputer, moves to `Disputed`, emits
  `ResolutionDisputed(disputer, bond)`. `Disputed` freezes finalization
  permanently; only the resolver can settle.
- **Settlement from `Disputed`** — `resolve(side)` becomes the resolver's
  dispute-settlement call: requires `Disputed` (no window, no time gates —
  the facts have been contested and a human is deciding), sets the side,
  moves to `Resolved`. `cancel()` (below) is the draw settlement.
- **`cancel()`** — unchanged in spirit: `onlyResolver`, now callable from
  `Trading`, `ResolutionPending`, or `Disputed`. Remains the postponement /
  draw / wrong-market escape hatch and is intentionally never time-gated.

`redeem`/`redeemCancelled` are untouched — they gate on the terminal
statuses exactly as today.

### Bond mechanics

- **Size:** `disputeBond` is fixed per market at graduation (passed through
  `prepareMarket` alongside the time gates; the adapter configures it).
  Denominated in the market's collateral token. Proposed default: a flat
  protocol-wide constant (order of 100 collateral units) rather than a
  percentage of escrow — predictable UX, spam-deterring, and independent of
  market size. Sizing is an explicit open question below.
- **One active dispute.** The first dispute freezes the market; subsequent
  `dispute()` calls revert. A dispute is a request for human adjudication,
  not a vote — additional bonds add operator load without adding
  information.
- **Bond disposition at settlement:**
  - Final outcome **differs** from `proposedSide` (including settlement by
    `cancel()`): the dispute was substantively right — bond refunded to the
    disputer in full.
  - Final outcome **equals** `proposedSide`: bond forfeited to the protocol
    owner (same sink as creation fees). Forfeited bonds must never enter
    the market's redemption collateral: solvency accounting tracks the bond
    separately from escrow so redemption math is unchanged.
  - Every movement emits a dedicated event (`DisputeBondPosted`,
    `DisputeBondRefunded`, `DisputeBondForfeited`) so the indexer's money
    paper trail (repo AGENTS.md invariant) records each transfer
    receipt-linked from chain events.
- **Resolver self-dispute is free.** `dispute()` called by the resolver
  address skips the bond transfer. This is the operator override path: the
  operator noticing a wrong pending verdict disputes their own proposal and
  settles correctly. It replaces repo ADR 0012's off-chain 24h operator
  delay — the delay is now the on-chain window itself, and the runner may
  submit `proposeResolution` as soon as the verdict clears its gates.

### Window sizing

`disputeWindow` is immutable per market, set at graduation: **24 hours** on
deployed networks. Local/dev stacks configure a short window (seconds) so
lifecycle tests exercise the full propose → dispute/finalize flow without
clock jumps. A zero window is permitted at the contract level (degenerates
to today's behavior) but deployed configurations must not use it.

### ADR 0012 (singleton book) compatibility

Every piece of state introduced here — `proposedSide`, `proposedAt`,
`disputer`, `disputeBond`, `disputeWindow`, the new statuses — is
per-market and maps 1:1 onto `marketId`-keyed book state. Events gain a
`marketId` index on the book exactly as the existing lifecycle events do.
Implementing on today's `CompleteSetBinaryMarket` first (Arc Testnet
reality) does not fork the design: the book absorbs it as specified when
ADR 0012 lands.

## Consequences

- A wrong AI resolution is no longer final: any token holder can buy 24
  hours of human adjudication for the price of the bond, and the operator
  can do the same for free. The cost is resolution latency — every market
  waits the full window even when the verdict is obviously right.
- Winning-side redemption starts one window later than today. UI must
  surface the pending state and countdown (repo ADR 0018's terminal-surface
  work grows a `resolution_pending`/`disputed` state pair).
- The keeper gains a finalize duty (one transaction per resolved market —
  compatible with the launchpad scale mandate; batched finalization on the
  singleton book is a natural follow-up there).
- A frivolous-dispute attacker can delay every market by one adjudication
  cycle per bond they are willing to burn. The flat bond prices that attack
  linearly; the single-dispute rule caps the per-market damage at one
  operator decision.
- This is a breaking ABI change to a funds-holding contract: human review
  required (repo ADR 0016 rule), all hand-encoded event fixtures and the
  generated ABI surface regenerate, and `dev-market-resolve` tooling and
  the lifecycle harness must drive the new flow.

## Phase 0 decisions (locked 2026-07-23)

1. **Bond sizing** — a flat protocol-wide constant on the order of 100
   collateral units, configured per market at graduation via
   `prepareMarket` (so the constant can be tuned without touching deployed
   markets). Escrow-proportional sizing rejected for v1: predictable UX
   and spam economics beat whale-proportional shielding.
2. **Forfeited-bond sink** — the protocol owner, mirroring creation fees.
   Never enters the market's redemption collateral.
3. **Disputer reward** — none in v1. A correct dispute already protects
   the disputer's own position; a bounty invites adversarial
   verdict-flipping games against the operator.
4. **Re-proposal after settlement** — settlement from `Disputed` is final
   by resolver fiat in v1. Revisit only if operator trust assumptions
   change.

## Related

- Repo ADR 0024 — the cross-stack program (indexer, runner, keeper, API,
  UI slices) that lands this mechanism.
- Repo ADR 0012 — AI-assisted resolution (the resolver whose fallibility
  motivates this).
- Repo ADR 0019 — the measured-verdict-quality program quantifying that
  fallibility.
- Protocol ADR 0010 — why graduation clearing has _no_ challenge window;
  the contrast case.
- Protocol ADR 0012 — the singleton book this design must (and does)
  transfer onto.
