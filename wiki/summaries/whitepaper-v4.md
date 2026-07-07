---
type: summary
title: Whitepaper v4 — Virtual LMSR and Band-Pass Graduation Clearing
description: Full mechanism spec (rev 0.4, June 2026) — virtual LMSR pricing of receipt intents, band-pass graduation clearing, the E = R + L solvency identity, fill-outcome bounds, and worked golden examples
sources:
  - documents/whitepaper_v4.pdf
updated: 2026-07-07
---

# Whitepaper v4 — Virtual LMSR and Band-Pass Graduation Clearing

_PredictFun: Bootstrapping Prediction Markets With Virtual LMSR And Band-Pass
Graduation Clearing_, Matthew Brown, June 2026, WORKING DRAFT rev. 0.4
(19 pages). This is the **mechanism source of truth** per protocol ADR 0002 —
see [mechanism whitepaper](../concepts/mechanism-whitepaper.md). Everything
below is what the paper actually specifies, with section references.

## The problem and the shape of the answer (§1–§2)

A new prediction market needs a credible price before it has liquidity, but in
a thin market every trade moves the price violently. Subsidized market makers
fix this for flagship markets and fail for the long tail. §2 fixes the
*destination* first: fully collateralized CTF-style YES/NO outcome tokens
(Polymarket/Gnosis Conditional Tokens), where a complete set is backed by
exactly one unit of collateral. The bootstrapping constraint is that a
prediction market cannot safely sell 100 final YES claims at 0.05, collect 5,
and owe 100 — unless something funds the missing 95. §2 rejects the candidate
launch mechanisms one by one: pari-mutuel pools (solvent but never convert to
fixed-payout claims), reserve AMMs (real reserves take outcome risk, virtual
reserves cannot pay winners), order books (an empty book discovers nothing),
and conventional LMSR (smooth quotes but needs a funded `b ln 2` loss budget
per market).

The paper's mechanism is a three-stage lifecycle (§1) — see
[market lifecycle](../concepts/market-lifecycle.md):

1. **Bootstrap** — a virtual LMSR prices intents; no subsidy, no final fills.
2. **Graduation** — band-pass clearing converts path-compatible intents into
   complete sets.
3. **Standard market** — CTF-style YES/NO tokens trade on an ordinary venue.

The virtual curve is scaffolding: it exists to discover a price and gather
committed demand, and it retires itself at graduation.

## Virtual LMSR (§3)

Pre-graduation markets run full LMSR math with reinterpreted state:

- `q_yes`, `q_no` are **demand-pricing state, not sold inventory**.
- `b` is **virtual smoothness, not a funded loss budget** — a free per-market
  design parameter, because no final token is ever sold from the curve.
- Every bet is a priced intent whose collateral stays escrowed; no final
  YES/NO token exists before clearing.

Define the path coordinate `r = q_yes − q_no` with marginal price
`P_yes(r) = 1 / (1 + e^(−r/b))` and `P_no(r) = 1 − P_yes(r)`. A market opens
at any prior probability `P0` via a pure state offset `r0 = b·ln(P0/(1−P0))`
— a coordinate, not collateral, so a 5% longshot can be quoted honestly
without fake depth (offset ≈ `−2.944·b` for 5%).

The displayed quote is an implied probability and the exact pricing rule for
the next intent — **but not a fill**: quoting 35% does not mean anyone can
settle exposure at 35%, because no opposing collateral is proven to exist
there. Treating virtual-LMSR buys as final tokens would silently reintroduce
the missing subsidy as bad debt; the mechanism instead records exactly which
part of the curve each bet bought and defers "what is real" to graduation.

## Receipts: priced intents over a price range (§4)

Each pre-graduation buy creates a **receipt**. A YES buy of `s` shares raises
`r` by `s`; a NO buy lowers it by `s`; every receipt therefore traverses an
interval `[r_low, r_high]` on the path coordinate whose **width equals its
share count**.

**Path cost.** The cost basis is the integral of the marginal price over the
interval, with closed forms. In probability terms, for a segment from
displayed probability `P_a` to `P_b`:

```txt
YES cost = b · ln((1 − P_a) / (1 − P_b))
NO  cost = b · ln(P_a / P_b)
```

Every number in the worked examples reproduces from these two formulas. The
average price `c/s` is display-only and **deliberately plays no role in
clearing**: cost is distributed unevenly along the interval (early slices of a
YES buy are cheaper than late slices) and clearing must respect that.

**What is being bought.** A receipt is a priced intent over a *range* of odds
— "a dense strip of tiny limit orders, one resting at every price in the
range, except that none of them has filled yet." Graduation decides slice by
slice which parts became real; every slice either converts to a fixed-payout
share at its own recorded price or refunds at its own recorded price. Nothing
settles at an average that mixes slices.

**Budget entry.** A trader specifying a budget `c` instead of shares gets the
share count by inverting the cost function (closed form given in §4).

**Rights.** A receipt grants exactly three rights: (1) participate in
deterministic graduation clearing, (2) receive fixed-payout tokens for every
matched path segment at that segment's recorded cost, (3) refund of every
unmatched segment's recorded cost. It does **not** grant: a guaranteed fill; a
final YES/NO position before clearing; the ability to withdraw, transfer, or
sell the receipt before clearing or cancellation (in v1); or any resolution
payout before graduation. The withdrawal lock is deliberate — free exit would
make the bootstrap curve a costless pump-and-withdraw manipulation surface,
and locked receipts keep clearing deterministic (the algorithm replays a
frozen book).

## Why aggregate matching fails (§5)

Receipts record paths because nothing coarser is safe to clear. Five rejected
shortcuts:

1. **Unfunded loss bound** — pointing at `b ln 2` just hides the subsidy.
2. **Global share proration** — equal YES/NO totals do not imply the sides
   met: a YES wave 5%→20% and a NO wave 80%→65% share no band.
3. **Global collateral proration** — dollars matched against dollars fails
   because solvency constrains retained *share count*, not retained dollars.
4. **Average-price partial fills** — settling a partial fill at the receipt
   average over-refunds one segment, under-collects another, and breaks the
   accounting band by band.
5. **Virtual reserves** — imitate depth but cannot redeem winning claims.

What survives is the path itself, compared at full resolution.

## Band-pass graduation clearing (§6)

See [graduation clearing](../concepts/graduation-clearing.md). The name is by
analogy with a band-pass filter: pass exactly the price bands traversed by
both YES and NO demand in opposite directions, reject the rest.

**The sweep** (deterministic, over a frozen receipt book):

1. Convert every active receipt into its interval `[r_low, r_high]`.
2. Collect all interval endpoints; sort; deduplicate.
3. Sweep each adjacent band `[r_k, r_{k+1}]`, skipping zero-width and
   dust-width bands.
4. Count YES receipts whose intervals cover the whole band: `Y_k`.
5. Count NO receipts covering the whole band: `N_k`.
6. If either count is zero the band fails — nothing in it is retained.
7. Otherwise retain the scarce side fully, the crowded side pro-rata, with
   `m_k = min(Y_k, N_k)`.
8. Credit each covering receipt with its retained band shares and cost.
9. After the sweep, refund every receipt's unretained path cost.
10. Sum matched market cap `F` and apply the graduation decision (§7).

Because the endpoint set includes every receipt boundary, each band is fully
inside or fully outside any receipt — no partial coverage. The sweep is
**time-symmetric**: a receipt matches any opposite-side receipt that covered
the same band regardless of trade order; sequence indices exist only for
deterministic ordering and rounding tie-breaks. (A FIFO variant would be a
coherent alternative allocation policy layered on the same solvency math.)

**Band arithmetic.** With band width `w_k`, retained fractions are
`m_k / Y_k` for YES and `m_k / N_k` for NO; each covering receipt keeps
`w_k · fraction` shares and `band_cost · fraction` cost. Proration scales
shares and cost by the same fraction — it changes how much of a band a
receipt keeps, **never the per-share price** of what it keeps. Matched market
cap per band: `F_k = w_k · m_k`.

**Local collateral completeness.** Since `P_yes(r) + P_no(r) = 1`, the YES
cost plus the NO cost of any band equals its width — which is also the
number of complete sets the band represents. So one YES and one NO segment
overlapping a band carry exactly the collateral that backs the band's
complete sets, one unit per set, locally — see
[complete sets](../concepts/complete-sets.md). Locked collateral
`L_k = m_k · w_k = F_k`. Completeness is proven band by band; no band can be
solvent at another's expense.

**Conservation identity.** Summing over matched bands and refunding all else:

```txt
E = R + L          (escrow = refunds + locked collateral)
L = F              (locked collateral = retained market cap)
maximum winner payout <= L
```

Per receipt: `retained_cost + refund = c` (cost-basis preservation — clearing
splits escrow without creating or destroying a unit). **This mechanism charges
no fees**; if fees are ever added they must appear explicitly as
`E = R + L + fees`, never implicitly (relevant to
[creation-fee custody](../concepts/creation-fee-custody.md): any fee the
protocol charges must live outside this identity).

## Graduation: the bridge to a standard market (§7)

Graduation is the point of the design. Once enough path-compatible demand
exists, the market should leave the virtual phase as fast as possible — a
CTF-style market is simply better once it has liquidity.

- The decision variable is `F`, the path-compatible filled market cap —
  **deliberately not** provisional volume, headline open interest, total
  escrow, or the displayed price (all can be large while `F ≈ 0`).
- Lifecycle is short and total:
  `open for intents → frozen for clearing → graduated` (tokens minted,
  residual refunds paid), or
  `open for intents → close time below threshold → not graduated` (every
  receipt refunded **in full** — the no-subsidy rule is unconditional).
- Once eligible, **anyone may freeze** the market; clearing runs over the
  frozen book.
- Sub-threshold overlap may be mathematically solvent, but the threshold
  defines the minimum viable fixed-payout market. It can be paired with
  non-price gates (unique-participant minimums, concentration limits) — those
  sit outside the clearing math; the clearing primitive remains `F`.
- **Handoff output:** retained YES balances, retained NO balances, locked
  collateral equal to one unit per complete set, and market metadata plus
  resolution rules. Any venue preserving the complete-set invariant can host
  the tokens (CLOB, CTF-compatible AMM, hybrid); it inherits fully backed
  tokens and never rescues undercollateralized receipts. Post-graduation
  venue design and resolution are **modular layers outside this paper's
  scope** — see [postgrad market](../entities/postgrad-market.md).

## Fill outcomes: bounds from the bettor's side (§8)

A receipt with shares `s` and escrowed cost `c` ends in exactly one of four
ways:

| Outcome | Condition | Retained shares | Refund |
|---|---|---|---|
| No graduation | threshold never reached | 0 | `c` (full) |
| Graduated, no overlap | no band of the range cleared | 0 | `c` (full) |
| Graduated, partial fill | some bands cleared / side crowded | 0 < ret < s | `c − retained cost` |
| Graduated, full fill | every band cleared, side scarce throughout | `s` | 0 |

- Worst case is a full refund (cost = time value of the lock); best case is a
  full fill at the exact prices originally paid; every intermediate case is a
  per-band mixture, never a blend at made-up prices.
- **Quantity is uncertain, price is not**: other traders decide which slices
  fill and in what fraction; they cannot make any filled slice more expensive.
- **Price bounds:** for a YES receipt over `[u, v]` with any nonzero fill, the
  effective price of retained shares lies within `[P(u), P(v)]` — the ends of
  the range the bettor chose to sweep, never outside it. Time-symmetry makes
  both ends reachable.
- **Payoff bounds:** a winning bettor profits on any nonzero fill (payout
  `ret × 1 > rc` since every marginal price < 1); a losing bettor loses only
  retained cost — never unfilled escrow, never more than escrowed. No
  negative refund, no socialized loss, no claim paid from anyone else's
  principal.

## Worked examples (§9) — golden test data

**Example A: three traders, one graduation.** `b = 100`, market opens at 20%.

| Receipt | Side | Price path | Shares `s` | Cost `c` | Avg price |
|---|---|---|---|---|---|
| Alice | YES | 20% → 40% | 98.08 | 28.77 | 0.2933 |
| Noah | NO | 40% → 30% | 44.18 | 28.77 | 0.6511 |
| Bea | YES | 30% → 35% | 22.83 | 7.41 | 0.3247 |

Bands: 20–30% (width 53.90, YES-only, fails); 30–35% (width 22.83, Alice+Bea
vs Noah, `m_k = 1`, YES fraction ½, `F_k = 22.83`); 35–40% (width 21.36,
Alice vs Noah, 1:1, `F_k = 21.36`). Note the time symmetry: Noah traded once
yet matches Alice (before him) and Bea (after him).

| Trader | Retained shares | Retained cost | Refund | Effective price |
|---|---|---|---|---|
| Alice | 32.77 YES | 11.71 | 17.06 | 0.3573 |
| Bea | 11.41 YES | 3.71 | 3.71 | 0.3247 |
| Noah | 44.18 NO | 28.77 | 0 | 0.6511 |

Alice's effective price rose from 0.2933 to 0.3573 (cheap 20–30% slices
refunded) but stays inside her [0.20, 0.40] bound; Bea keeps half her shares
at exactly her original average (proration scales shares and cost together);
Noah is scarce everywhere he traveled and fills completely. With threshold 40,
`F = 44.18 ≥ 40`: 44.18 YES + 44.18 NO tokens mint against 44.18 locked
collateral; 20.76 flows back as refunds. Settlement is a closed pool (nets sum
to zero): YES true → Alice +21.06, Bea +7.71, Noah −28.77; NO true → Alice
−11.71, Bea −3.71, Noah +15.42. Alice's worst case is her retained cost 11.71,
not her 28.77 escrow. Threshold 50 → nobody graduates, all refunded in full.

**Example B: large drift is not backfilled.** A market opens at 5%; a large
YES intent moves it to 35%; churn near the new price (NO 35→32, YES 32→34, NO
34→33, YES 33→34) clears only the bands it retraces. The one-sided 5%→32%
drift refunds at path cost however informative it was — "information is not
collateral." This is the answer to paint-the-curve manipulation: drift without
opposing flow converts at graduation into the manipulator's own refund;
backfilling would require the very thing the drift lacks — someone real on
the other side.

## Properties (§10)

No subsidy (unmatched demand refunded, never socialized); continuous price
discovery from the first block at any prior; fixed-payout discipline (never
drifts pari-mutuel); price-certain, quantity-uncertain fills; cost-basis
preservation (`retained_cost + refund = c`, no hidden fees); bounded downside
(worst case full refund, losses capped at retained cost); deterministic
clearing (same frozen book + `b` + initial state + rounding rules ⇒ identical
results in every implementation); solvency by construction (`L = F` band by
band).

## Limitations and open questions (§11)

Acknowledged costs: locked capital (no withdrawal/transfer/sale before
clearing); no guaranteed fill (the promise is exactness, not certainty);
refund disappointment (a popular one-sided market can end in a large refund
event — the mechanism working, but interfaces must label receipts provisional
and surface estimated retention and per-band exposure); range cognition (the
strip-of-limit-orders framing and the §8 outcome table "belong in the
product, not just in this paper"); graduation gaming (clearing math is
indifferent to who trades — thresholds should be paired with non-price gates
such as unique-participant minimums, concentration limits, time-in-book
requirements).

Open questions (none change the solvency argument): how `b` should vary with
market category/volatility/prior; what threshold yields viable post-grad
liquidity; what rounding policy best preserves determinism under onchain
integer arithmetic; which anti-manipulation gates earn their complexity;
whether receipts can be made transferable without reopening manipulation and
refund-ownership problems.

## Status and scope notes

- The paper is a working draft (rev 0.4) titled under the "PredictFun" name;
  the repo product name is Pop Charts.
- It specifies stages 1–2 (bootstrap + graduation) precisely; the post-grad
  venue and resolution are explicitly modular and out of scope. Resolution
  design lives in the earlier drafts — see
  [whitepaper history](whitepaper-history.md).
- The mechanism as specified charges **no fees of any kind**; the repo's
  creation-fee design is an extension that must stay outside the `E = R + L`
  identity ([creation-fee vault](../entities/creation-fee-vault.md)).
- The pre-graduation phase is implemented by the
  [pregrad manager](../entities/pregrad-manager.md) in the
  [protocol workspace](../entities/protocol-workspace.md).

## Related pages

- [Mechanism whitepaper](../concepts/mechanism-whitepaper.md)
- [Market lifecycle](../concepts/market-lifecycle.md)
- [Graduation clearing](../concepts/graduation-clearing.md)
- [Complete sets](../concepts/complete-sets.md)
- [Whitepaper history (v0.1 → v3 → v4)](whitepaper-history.md)
