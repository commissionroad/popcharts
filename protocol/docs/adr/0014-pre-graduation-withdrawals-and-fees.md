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

- **Solvency.** The argument imports intuition from a _funded_ LMSR, where a
  pooled reserve must equal `C(r) − C(r₀)` and refunding a trader's original
  cost after the curve moved leaves a hole. A virtual LMSR has no pool. Escrow
  is per-receipt and completeness is proved per band, so returning a receipt's
  own recorded cost removes a row and its money together and leaves `E = R + L`
  intact.
- **Determinism.** Clearing is deterministic because the book is _frozen at
  clearing_, not because it was append-only before it.
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
does — a running estimate that cannot be vested. Whether a band has _ever_ been
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

### 3. The pre-graduation fee is a success fee, and it is a second escrow

- **Entry fee `φ_in` = 1%**, charged on a receipt's cost at purchase but
  **earned only on the part that matches**.
- **Withdrawal fee `φ_out` = 5%** on the recorded cost of a withdrawn band,
  earned immediately and never refunded.

A buyer of a receipt costing `c` transfers `c(1 + φ_in)`. The `c` becomes
escrow; the `c·φ_in` is held separately but is **not yet protocol money**. At
clearing the protocol keeps `φ_in · retained_cost` and returns the rest, so
every refunded dollar comes back with the fee prepaid on it — refunds are
`101%` of unmatched cost. Because `L = F` (the Theorem), the sum across
receipts is exact:

```
protocol earns exactly  φ_in · F
```

Example A: Alice prepays 0.2877 and earns out 0.1171; Bea 0.0741 → 0.0371;
Noah 0.2877 → 0.2877. Collected 0.6495, kept 0.4419 = 1% of `F` = 44.19,
returned 0.2076 = 1% of the 20.76 refunded. A withdrawal is the same rule: an
unopposed band never matched, so its prepaid fee returns with it and the
withdrawer pays exactly `φ_out` of the withdrawn cost — 13.35 out returns
12.6825, penalty 0.6675.

**Collecting up front is forced, not merely convenient.** The fee cannot be
billed at clearing: a fully-filled receipt has no refund to deduct from, and
taking it from `L` would break `L = F`. **A fee taken out of `L`, or netted
against refunds, is forbidden** — `L = F` has no slack, and an implicit fee
breaks exact collateralization.

The consequence worth keeping deliberately: **the entry fee is a success fee.**
The protocol earns only on markets that graduate. On a market that fails to
graduate, or one an owner cancels
([ADR 0011](0011-admin-market-cancellation.md)), the entry fee refunds in full
alongside escrow. Withdrawal penalties do not — they are earned on the act, not
on the outcome, and stay with the protocol in every case.

This makes the entry fee **a second escrow with its own settlement rule**, not
a fee pot. Two consequences for the implementation:

- It cannot use the `CreationFeeVault` shape, which is collect-segregate-owner-
  withdraws. The owner must not be able to withdraw money that may have to go
  back to traders.
- **Store the paid fee on the receipt; do not derive it.** If `φ_in` is
  owner-configurable, deriving `φ_in · cost` at refund time pays the _current_
  rate on an _old_ receipt.

`φ_out` is set at 5%, not 10%. It buys neither solvency (Lemma 3 covers that)
nor protection from pump-and-withdraw (the lock rule forecloses it, since the
pump commits the moment anyone responds). It prices only the residue: moving
the display and retracting it while nobody responds. That harm is external to
the market, so nothing inside calibrates the rate — and the withdrawer is
collecting a refund the mechanism already guaranteed them, early, so a rate
high enough to deter a determined manipulator is paid mostly by honest
impatience. Charging on cost under-prices withdrawals of cheap extreme bands,
which are the display-moving ones; charging on withdrawn _width_ would target
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

**Fees alone cannot seed a usable pool, and no rate fixes that.** Pool depth
per side is `Φ/2`, so as a fraction of matched cap it is exactly `φ_in / 2` —
5% depth would need a 10% entry fee, 10% depth a 20% one. At `φ_in` = 1% the
pool holds 0.5% of market cap: on Example A, 0.221 tokens against 44.2
outstanding, so a holder selling 1% of their position swamps it and the price
goes 35% → 3.9%.

Seeding is therefore **topped up with protocol capital to 10% of the
graduation threshold**, with the fee pot counting toward that cap rather than
adding to it. On Example A that is 4.0 against a 0.442 fee pot — the subsidy
does 9× what the fees do, depth reaches 5.0% of cap, and the same 1% sale moves
the price 35% → 24.3% instead of to 3.9%.

Two honest notes on that. First, sizing off the _threshold_ means depth is
anti-proportional to success: a market graduating at 5× threshold gets 2% of
cap, at 10× only 1%. Sizing off `F` — known at the moment of seeding — would
hold depth constant, and is left open below. Second, this is protocol capital
at risk in a position that resolution destroys, which is what makes the
pre-resolution unwind load-bearing rather than tidy.

### 5. Post-graduation trading fees

The v4 stack already separates three layers, and they compose rather than
compete: the native protocol fee is taken first, the LP fee applies to the
remainder, and a hook fee may be added on top. Measured from the vendored
v4-core, `MAX_PROTOCOL_FEE = 1000` — the native protocol fee is capped at
**0.1%**; `MAX_LP_FEE` is 100%; hook fees are uncapped.

**Decision: the LP fee goes entirely to LPs, and the protocol takes the native
0.1% and nothing more.** No hook fee, and no fee on `mintCompleteSets`.

- **LPs keep the whole LP fee.** They are the only reason the venue has depth
  after the protocol's seed is unwound; taking a cut of their fee to fund the
  protocol makes the venue permanently subsidy-dependent.
- **No hook fee** keeps `BoundedPredictionHook` free of fee-taking. Both swap
  callbacks already return fee-shaped values (`BeforeSwapDelta`, `int128
hookDelta`) and both currently return zero — this decision keeps them zero.
- **No mint fee.** It is avoidable anyway (buy from the pool instead), and it
  widens the band the keeper arbitrage uses to hold `YES + NO ≈ 1`. With 1% on
  swap, mint, and merge the two pools may disagree by **±2%** — a persistent
  gap between "YES says 35%" and "NO says 63%" that every user can see. Fees on
  swaps alone give ±1%; exempting the keeper collapses it to zero. If a mint
  fee is ever added, **the keeper must be exempted in the same change.**

The graduation handoff path (`fundRetainedCollateral`, `mintRetainedSide`) is
**never** feeable — it is the clearing output, and taking collateral out of it
breaks `L = F`. It is already a separate function from `mintCompleteSets`, so
the exemption is structural rather than a guard.

### 6. Creator revenue

The creator earns from both surfaces, weighted toward the one that tracks
question quality rather than churn:

- **10% of the pre-graduation success fee**, paid at graduation. This rewards
  a question that attracted genuine two-sided demand — the thing that makes `F`
  large — rather than volume. On Example A: 0.044 to the creator, 0.398 to the
  protocol.
- **A share of the native 0.1% protocol fee**, ongoing.

The second needs an implementation note, because v4 will not do it for us:
`ProtocolFees.sol` accrues into `mapping(Currency => uint256)` — **per
currency, not per pool** — so every market sharing a collateral token pools its
protocol fees into one bucket with no on-chain attribution to a market or a
creator. Per-market attribution therefore comes from **off-chain accounting**:
the indexer already ingests per-pool swap observations, so each market's volume
share is computable and payable out of collected protocol fees.

That is a trusted computation. It is reproducible from chain data and each
payout still leaves an on-chain record, which satisfies the money paper-trail
rule, but the derivation is not itself trustless. The trustless alternative is a
hook fee, which is attributable because the hook sees the `PoolKey` — rejected
above for the LP-competition and complexity reasons, and revisitable if creator
payouts ever grow enough to be worth arguing over. At current sizing they are
not: on Example A the creator's combined take is roughly 0.15% of matched cap.

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
- [x] **P2 — Off-chain opposition + withdrawal quote (delivered 2026-08-10).**
      The opposed/free split (`opposed-set.ts`, landed with the P3 spike) and
      `quoteWithdrawal` (`withdrawal-quote.ts`) are exported from the package
      surface: free segments, recorded path cost per segment, gross refund,
      fee, and net payout. Golden tests pin whitepaper v0.6 Example A — Alice
      44.18 locked / 53.90 free, 13.35 of 28.77 recoverable, quoting 12.6825
      net with a 0.6675 penalty at `φ_out` = 5%; Noah and Bea fully locked,
      zero quote. The property test (withdrawing every free band of every
      receipt leaves `F` bit-identical, 398 walk books) runs through the
      exported surface and asserts the quote's free set is the split's free
      set exactly. Rounding: the fee is one full-precision multiply, floor
      divide on the gross refund — `entryFeeFor`'s mulDiv convention — decided
      in `withdrawal-quote.ts`; P3/P4b enforce the same formula on chain.
- [ ] **P3 — On-chain `withdrawReceiptBands`.** Refund the free bands' path
      cost net of `φ_out`, decrement `totalEscrowed` and `state.path`, and emit
      a receipt-mutation event the indexer can replay.

      **The opposed set cannot simply be computed on chain.** `ReceiptBook`
      stores receipts in `mapping(uint256 receiptId => Receipt)` keyed
      globally; `market.state.receiptCount` is a counter, not an index. There
      is **no per-market receipt enumeration on chain at all**, so a
      withdrawal cannot iterate the opposite side to find out which of its
      bands are opposed. Two routes, and the choice determines what P1 must
      store:

      1. **Maintain a per-market coverage union per side** (not chosen).
         Placing a receipt merges its interval into its own side's union; a
         receipt's opposed set is then `I_ℓ ∩ opposite_union`, no iteration
         required. Sound — a band only ever leaves the live book while
         unopposed, which is exactly a band no one's opposed set depends on —
         but structurally worse in both variants. A monotone union never
         shrinks, so a withdrawn interval's coverage over-locks everything
         placed over the vacated region later, and place-then-withdraw *buys*
         that poisoning for `φ_out` of the poisoner's own path cost, principal
         refunded in full. An exact live union fixes over-locking by
         cover-counting, at two storage writes on every placement forever and
         a withdrawal-time read that walks every live boundary left of the
         receipt. Both variants fragment without bound under a legal
         alternating trade sequence (one permanent fragment per cycle), and a
         fragment cap degrades into blocked placements or forced
         over-locking.
      2. **Compute off chain and verify on chain** (chosen), the clearing
         shape of
         [ADR 0006](0006-use-optimistic-offchain-graduation-clearing.md): the
         withdrawer submits the free segments as a claim; the contract checks
         containment in the receipt's live support, prices the refund with the
         LMSR band math it already has, removes the segments from live support
         at request time, and pays after a challenge window
         (owner-configurable per ADR 0010 — zero while a manager-run service
         attests claims, exactly clearing's v1 trust model). The claim's one
         unverifiable statement — "no live opposite-side receipt covers these
         bands" — is an absence over an unenumerable mapping, and that is
         where the optimistic pattern is strongest: a challenger refutes it by
         naming one opposite-side receipt id, which the contract loads from
         the global mapping and checks for market, side, liveness, and
         overlap — O(1) whatever the book's size or shape. Three rules keep
         the races out: claimed segments stay recorded on the pending request
         until finalization, so a colluding opposer's own withdrawal cannot
         outrun refutation; each request's challenge deadline is stamped at
         request time (ADR 0010's in-flight pattern) and never precedes an
         earlier request's, with challenges landing strictly inside the
         window and finalization waiting for it, so a dependent claim can
         never finalize while the claim that enabled it is still
         challengeable; and a `nextReceiptId` snapshot stamped at request
         time — never taken from the requester — pins the refutation set, so
         coverage placed during the window cannot invalidate an honest
         claim. The sharpest attack — a colluding pair requesting both sides
         of an opposed band, the second request passing because the first
         emptied the live view — therefore extracts the band only if both
         claims survive their windows unchallenged: one challenger refutes
         the first claim by the second's pending-recorded coverage and the
         second by the restored first, so the residual risk is exactly
         clearing's honest-watcher assumption, which the v1 attester
         discharges by refusing the false claim at the zero window. The
         costs are real: withdrawal is request-then-finalize rather than
         instant, the freeze must settle pending requests (trivial at a zero
         window), challenge bonds are deferred exactly as clearing's are,
         and turning the window on later inherits clearing's honest-watcher
         assumption on a per-user path.

      **Decision (2026-08-10): route 2.** Route 1 taxes the high-frequency
      operation — placement — with unbounded shared state to subsidize the
      rare one, and every escape from its adversarial cases either blocks
      trades or reintroduces over-locking; route 2 leaves placement untouched,
      prices withdrawal in bounded gas and calldata (164–228 bytes organic,
      capped by P1's segment cap), needs no fragment cap, cannot be poisoned,
      and asserts the one kind of negative an optimistic protocol can refute
      in O(1) — all on the trust model this repo already accepted for
      clearing. Measured over 398 seeded random-walk books (4–40 receipts,
      withdrawals interleaved): organic union state is small (p95 3 fragments
      per side, ≤3 records touched per placement), but the monotone variant
      still over-locks 0.36% of live escrow — 3.0% of the truly free set,
      80/398 books affected — and the alternating construction grows a
      64-fragment union whose merge lands on the next honest spanning
      placement. Prototypes, the split, and the harness:
      `protocol/src/clearing/opposed-set.ts`, `coverage-union.ts`,
      `withdrawal-claim.ts`, and their `protocol/test/nodejs` suites.
      **P1 consequence:** `Receipt` carries its segment list and nothing else
      changes — no per-market union, no new market-state fields, no
      placement-path writes. The pending-request record (claimed segments,
      refund, deadline, `nextReceiptId` snapshot) is P3 storage, not P1.

- [x] **P4a — Entry fee (delivered 2026-08-08, PRs #494/#497/#519/#526).**
      Charged at `placeReceipt` and stored on the receipt; held outside
      `totalEscrowed`; refunded in full on both non-graduation paths; split
      pro-rata at the graduated claim via full-precision mulDiv; `maxCost`
      bounds the total debit; four paper-trail events ingested into
      receipt-linked tables; app quotes, bounds, approves, and displays the
      fee. Rate ships **disarmed** (0) — arming is an ops action via
      `local:set-entry-fee-rate` locally, `setEntryFeeRate` in production.
      Verified live end-to-end: 1% armed on a worktree stack, a browser
      placement debited cost + fee, and the indexer recorded the `collected`
      row at the exact floor-division amount.
- [ ] **P4b — Withdrawal fee.** Charged at P3's `withdrawReceiptBands`;
      blocked on P3's implementation like the rest of the withdrawal
      mechanism.
- [ ] **P5 — Graduation seeding.** At handoff, top the fee pot up to 10% of the
      graduation threshold from protocol capital, mint half the total as
      complete sets, and seed both pools per the `p*` split — through the
      existing postgrad adapter, never through the retained-side path.
- [ ] **P6 — Pre-resolution unwind.** Operator (or keeper) withdraws protocol
      liquidity before resolution and returns the proceeds. **P5 must not ship
      without P6** — seeding without an unwind path donates the pot to
      arbitrageurs, and the unwind is also what makes any third-party
      subsidy investable.
- [x] **P7 — Post-graduation fee controller (delivered 2026-08-10).**
      Mechanics in [docs/fee-model.md](../../../docs/fee-model.md).
      `PostgradFeeController` (a contract, not an operator EOA —
      `collectProtocolFees` emits no event, and the paper-trail rule needs
      one) deploys with the venue stack, where the venue owner installs it
      via `setProtocolFeeController` in the same Ignition module. Owner
      surface: per-pool arming (single and batch) validating both 12-bit
      directions against the 1000-pip cap, with the symmetric 0.1% default
      derived as `1000 | (1000 << 12)`; an evented full-accrual sweep,
      documented to run in its own transaction and never inside an
      unlock/settle cycle; and the outcome-token policy — pair held YES/NO,
      merge `min(yes, no)` floored to the decimal conversion grid before
      resolution, evented owner withdrawal for merged collateral and the
      unpaired remainder. **Nothing arms at deployment or graduation**:
      arming is an ops action (`local:arm-pool-protocol-fee` on a local
      stack, `armPoolProtocolFee` as the owner in production), matching the
      entry fee shipping disarmed. LP fee untouched, no hook change.
      Deferred: indexer ingestion of the controller's events, the creator's
      10% success-fee share paid at graduation (§6), and the creator's
      trading share from off-chain volume attribution.

## Deferred work

- **Fee charged on width rather than cost.** Better targeted at display
  manipulation; revisit if manipulation is observed.
- **Hard fragmentation bound.** The 2-segment measurement is empirical over one
  trade-generation model. The contract needs a cap; choosing it needs a
  worst-case analysis rather than a simulation average.
- **Transferability.** Blocked on refund ownership for fragmented receipts.
- **Seeding range selection.** Whether to seed full-range or inside
  `PoolTickBounds`, and how tight, is unmodelled here.
- **Seeding sized off `F` rather than the threshold.** Sizing off the threshold
  makes depth anti-proportional to success (5× threshold → 2% of cap, 10× → 1%).
  `F` is known when the seed is placed, so this is a change of one input.
- **Third-party pre-graduation subsidy.** Letting outside capital top the pool
  up to the cap, in exchange for a share of fees. Modelled but not decided: at
  80% of a 1% fee it break-evens only above ~6× the graduation target in volume
  _if held to resolution_, and is profitable at any volume if unwound before it.
  Whichever way it lands, subsidizers should earn as LPs rather than from the
  protocol's 0.1%, since the LP fee is both larger and already attributable.
- **Trustless creator attribution.** Only a hook fee gives per-market
  attribution on-chain. Revisit if creator payouts grow past the point where
  off-chain computation is worth arguing about.
- **Keeper exemption.** Not needed while no mint/merge fee exists. Required in
  the same change as any mint fee, or the `YES + NO` band opens to ±2%.
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
