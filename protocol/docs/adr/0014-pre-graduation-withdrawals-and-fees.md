# ADR 0014: Pre-Graduation Withdrawals, Fees, And Post-Graduation Seeding

## Status

Proposed

Supersedes the non-withdrawable half of
[ADR 0003](0003-keep-v1-receipts-locked-and-non-transferable.md). Receipts stay
non-transferable; they stop being unconditionally non-withdrawable.

## Context

`PregradManager` receipts are append-only. `MarketTypes.Receipt` stores a single
interval (`rLow`, `rHigh`) plus `cost`, `shares`, `side`, `sequence`, `active`,
and the only exit before clearing is `claimRefundedReceipt`, which requires the
market to have already reached a refund-claimable status.

Whitepaper v0.4 §4 justified that lock on two grounds. Both were re-examined
against the implementation and neither survives:

- **Solvency.** The argument imports intuition from a *funded* LMSR, where a
  pooled reserve must equal `C(r) − C(r₀)` and refunding a trader's original
  cost after the curve moved leaves a hole. A virtual LMSR has no pool. Escrow
  is per-receipt and completeness is proved per band, so returning a receipt's
  own recorded cost removes a row and its money together and leaves `E = R + L`
  intact.
- **Determinism.** Clearing is deterministic because the book is *frozen at
  clearing*, not because it was append-only before it.
  `computeBandPassClearing` reads only `rLow`, `rHigh`, `side`, `cost`,
  `shares`, and `sequence`; it never reads `market.state.path`. A withdrawal
  deletes a row from the frozen book and every remaining row clears identically.

The real objection is different and was not stated in the paper: an
unrestricted withdrawal is a **veto on graduation**. Simulated over random
books, a single largest holder walking out erases ~13% of matched cap `F` on
average and up to 100% in the small books the bootstrap phase exists to serve.
That is not theft — the counterparty is refunded in full, principal loss zero —
but it lets any large holder unilaterally deny the transition.

A narrower rule avoids it entirely, and it is the rule the mechanism was
already implying.

## Decision

### 1. Withdrawals: lock the overlap

A band of a receipt is **opposed** once any live opposite-side receipt covers
it. Opposed bands are locked for both receipts until clearing. Every other band
may be withdrawn before the freeze, refunding that band's own recorded path
cost less the withdrawal fee.

The property that makes this safe is that opposition is monotone where
retention is not. A receipt's retained share of a band is `m_k / Y_k`, which
falls when a same-side receipt arrives and rises when an opposite-side one
does — a running estimate that cannot be vested. Whether a band has *ever* been
opposed only accumulates.

An unopposed band has `m_k = min(Y_k, 0) = 0` before the withdrawal and
`min(Y_k − 1, 0) = 0` after, so `F` is unchanged. Whitepaper v0.6 Lemma 3
proves it; simulation over 398 random books of 4–40 receipts measured the
change in `F` at exactly zero, and the same over 400 books for a single largest
holder.

**The rule may not be loosened to "whatever clearing would refund."** That set
includes bands where the holder's own side is crowded (`m_k ≥ 1`). Removing
capital there either silently redistributes other holders' fills (when
`Y_k > N_k`) or lowers `F` outright (when `Y_k ≤ N_k`). Only the unopposed set
is inert.

### 2. Receipts become segment lists

Withdrawing an interior band splits a receipt, so `rLow`/`rHigh` become a
finite union of disjoint intervals. The solvency proof is indifferent — it only
ever uses the band partition — but storage, the sweep, the `ReceiptPlaced`
event shape, the indexer projection, and the clearing plan are not.

Measured fragmentation across 398 random books was **at most 2 segments** per
receipt, so the bound is small in practice. It is not bounded in theory, and
the contract must cap it (see deferred work).

### 3. Two fees, outside escrow

- **Entry fee `φ_in` = 1%** on a receipt's cost at purchase.
- **Withdrawal fee `φ_out` = 5%** on the recorded cost of a withdrawn band.

Neither touches escrow. A buyer of a receipt costing `c` transfers
`c(1 + φ_in)`; `c` becomes escrow and `c·φ_in` joins a separately-held fee pot
`Φ`. The accounting identity becomes `E = R + L + Φ`, with `E − Φ = R + L`
unchanged over escrow alone. **A fee taken out of `L`, or netted against
refunds, is forbidden** — `L = F` has no slack, and an implicit fee breaks
exact collateralization.

`φ_out` is set at 5%, not 10%. It buys neither solvency (Lemma 3 covers that)
nor protection from pump-and-withdraw (the lock rule forecloses it, since the
pump commits the moment anyone responds). It prices only the residue: moving
the display and retracting it while nobody responds. That harm is external to
the market, so nothing inside calibrates the rate — and the withdrawer is
collecting a refund the mechanism already guaranteed them, early, so a rate
high enough to deter a determined manipulator is paid mostly by honest
impatience. Charging on cost under-prices withdrawals of cheap extreme bands,
which are the display-moving ones; charging on withdrawn *width* would target
that better and is deferred until manipulation is actually observed.

### 4. Fee revenue seeds the post-graduation pools

At graduation, `Φ` is deployed as protocol-owned liquidity in the two v4 pools
rather than swept to a treasury. With `p*` the clearing price, requiring each
pool to be balanced at `p*` fixes the split rather than leaving it to choice:

```
mint    Φ/2 complete sets                    (costs Φ/2, yields Φ/2 YES + Φ/2 NO)
YES pool:  Φ/2 YES  +  (Φ/2)·p*        collateral
NO  pool:  Φ/2 NO   +  (Φ/2)·(1 − p*)  collateral
                                              total: Φ
```

Derivation: balance requires `c_Y = m·p*` and `c_N = m(1 − p*)`, so
`c_Y + c_N = m`; the budget gives `c_Y + c_N = Φ − m`; hence `m = Φ/2`. A pot
of 100 graduating at 35% mints 50 sets and seeds 50 YES against 17.50, and
50 NO against 32.50. The minted sets are backed by their own deposit, so this
adds collateralized supply beside the `F` sets clearing produced.

**Seeded liquidity does not survive resolution.** A position in a market that
settles to 0 or 1 is fully exposed to divergence. For a full-range
constant-product position seeded at 35%, terminal value is ~88% of holding the
same assets if YES wins and **~5% if YES loses**; at a 10% seed price the
losing case is ~10% of hold. The asymmetry is structural — the losing token
goes to zero and the pool ends up holding most of it.

Therefore: **protocol liquidity must be withdrawn before resolution.** This is
a required operational step, not an optimization. `PoolTickBounds` already
bounds ranges and can cap the loss, but bounding alone does not remove it.
Treat seeding as a service to traders during the market's life, funded by the
fees those traders paid — never as a treasury asset.

## Consequences

- Pre-graduation capital efficiency improves at the edges only. Measured across
  random books, ~15% of escrow becomes withdrawable and ~86% of the book stays
  locked. This is not free exit and the product must not present it as one.
- The graduation veto disappears by construction. The freeze/withdraw race has
  no payoff, so no eligibility guard or withdrawal cutoff is needed.
- A holder can be pinned by anyone willing to oppose them, at a price the
  mechanism fixes: YES and NO costs over a band sum to its width, so opposing a
  receipt costs the complement of what its holder paid. The opposing party takes
  a real position, so this is trading, not griefing — but it is cheap where the
  complement is cheap (opposing a receipt bought at 95% costs ~3% of what that
  holder committed).
- Receipts stay non-transferable. Lemma 3's argument extends to transfers by
  inspection — a transfer changes no band's covering counts — but refund
  ownership across a fragmented, partially withdrawn receipt is unresolved.
- The whitepaper is the source of truth for the mechanism; this ADR is the
  source of truth for parameters (`φ_in`, `φ_out`, fragmentation cap, seeding
  and unwind policy).

## Phases

- [ ] **P1 — Segmented receipts.** `MarketTypes.Receipt` carries a segment
      list; `ReceiptBook` insert/read paths, the `ReceiptPlaced` event, and the
      indexer projection follow. Enforce a per-receipt segment cap. No
      withdrawal yet; a never-withdrawn receipt stays a single segment, so this
      phase is behaviour-preserving and separately reviewable.
- [ ] **P2 — Off-chain opposition + withdrawal quote.** Extend
      `band-pass-clearing.ts` with the opposed/free split and a
      `quoteWithdrawal` helper, with golden tests against whitepaper v0.6
      Example A (Alice: 44.18 locked, 53.90 free, 13.35 of 28.77 recoverable;
      Noah and Bea fully locked). Property test: withdrawing every free band of
      every receipt leaves `F` bit-identical.
- [ ] **P3 — On-chain `withdrawReceiptBands`.** Compute the opposed set on
      chain, refund the free bands' path cost net of `φ_out`, decrement
      `totalEscrowed` and `state.path`, and emit a receipt-mutation event the
      indexer can replay.
- [ ] **P4 — Fees.** Entry fee at `placeReceipt`, withdrawal fee at P3, both
      into a fee pot outside `totalEscrowed`. Assert `E = R + L + Φ` in the
      clearing invariant suite alongside the existing triple-equality.
- [ ] **P5 — Graduation seeding.** At handoff, mint `Φ/2` sets and seed both
      pools per the split above, through the existing postgrad adapter.
- [ ] **P6 — Pre-resolution unwind.** Operator (or keeper) withdraws protocol
      liquidity before resolution and returns the proceeds. **P5 must not ship
      without P6** — seeding without an unwind path donates the pot to
      arbitrageurs.

## Deferred work

- **Fee charged on width rather than cost.** Better targeted at display
  manipulation; revisit if manipulation is observed.
- **Hard fragmentation bound.** The 2-segment measurement is empirical over one
  trade-generation model. The contract needs a cap; choosing it needs a
  worst-case analysis rather than a simulation average.
- **Transferability.** Blocked on refund ownership for fragmented receipts.
- **Seeding range selection.** Whether to seed full-range or inside
  `PoolTickBounds`, and how tight, is unmodelled here.
- **`φ_in` / `φ_out` calibration.** Both are judgement calls. Instrument
  withdrawal rates and display-retraction events before moving them.
- **Interaction with `cancelMarket`** ([ADR 0011](0011-admin-market-cancellation.md)):
  a cancelled market refunds everything, so withdrawal is moot, but the fee pot
  needs a disposition rule.

## Related

- [Whitepaper v0.6](../../../whitepaper/v0.6.md) — §4 the withdrawal rule, §6
  Lemma 3, §7 fees and seeding
- [ADR 0002](0002-treat-whitepaper-v4-as-mechanism-source.md) — mechanism source of truth
- [ADR 0003](0003-keep-v1-receipts-locked-and-non-transferable.md) — partially superseded
- [ADR 0007](0007-handoff-to-ctf-style-postgrad-market.md) — the handoff this seeds into
- [ADR 0008](0008-use-complete-set-erc20-v4-markets-on-arc-testnet.md) — the v4 venue being seeded
