# Fee model

Reference for every fee Pop Charts charges: where it is taken, **when it is
actually earned**, and what must stay true for the mechanism to keep its
solvency guarantees.

The decisions live in
[protocol ADR 0014](../protocol/docs/adr/0014-pre-graduation-withdrawals-and-fees.md)
and [whitepaper v0.6 §7](../whitepaper/v0.6.md); this page is the flat
reference an implementer reads first.

## The four fees

> **Status (2026-08-10).** The entry fee is implemented end to end — contract
> (#494), event tables (#497), indexer ingestion (#519), app quoting/approval/
> display (#526) — and ships with the rate at zero. Arming it is an ops
> action: `local:set-entry-fee-rate` on a local stack, `setEntryFeeRate` as
> the owner in production. The post-graduation 0.1% controller (P7) is built
> and installed with the venue stack — `PostgradFeeController` arms per-pool
> fees, sweeps with a paper-trail event, and merges outcome-token fees — and
> also ships disarmed: arming is an ops action (`local:arm-pool-protocol-fee`
> on a local stack, `armPoolProtocolFee` as the owner in production), and
> indexer ingestion of its events is deferred. The withdrawal fee (P3/P4b)
> is built contract-side and also ships disarmed: withdrawal is an optimistic
> request/refute/finalize on the manager, arming is an ops action
> (`local:set-withdrawal-fee-rate` on a local stack, `setWithdrawalFeeRate`
> as the owner in production), and indexer ingestion of its paper-trail
> events is the next PR in the stack.

| Fee | Rate | Charged | Earned | Refundable |
| --- | --- | --- | --- | --- |
| Market creation | fixed, native | at market creation | on collection | no |
| Entry `φ_in` | 1% of receipt cost — **built, ships disarmed** | at `placeReceipt` | at clearing, on **matched** cost only | **yes — in full if the market never graduates** |
| Withdrawal `φ_out` | 5% of withdrawn cost — **built, ships disarmed** | on withdrawing an unopposed band | at finalization, on the act | never |
| Post-graduation trading | 0.1% (v4 native cap) — **built, ships disarmed** | every swap | immediately | no |

The LP fee is deliberately not in that table. **It goes entirely to liquidity
providers.** They are the only reason the venue has depth once the protocol's
seed is unwound, so funding the protocol out of their fee would make the venue
permanently subsidy-dependent.

## Pre-graduation

### The entry fee is a success fee

Charged on the whole receipt, earned only on the part that finds a
counterparty. A buyer of a receipt costing `c` transfers `c(1 + φ_in)`: the `c`
becomes escrow, the `c·φ_in` is held aside and is **not yet protocol money**.

At clearing the protocol keeps `φ_in · retained_cost` per receipt and returns
the rest, so every refunded unit comes home carrying the fee prepaid on it —
refunds are `101%` of unmatched cost. Because the clearing theorem gives
`L = F`, the aggregate is exact:

```
protocol earns exactly  φ_in · F
```

Worked against whitepaper §9 Example A (`F` = 44.19):

| Trader | Cost | Prepaid | Earned | Returned |
| --- | --- | --- | --- | --- |
| Alice | 28.77 | 0.2877 | 0.1171 | 0.1706 |
| Bea | 7.41 | 0.0741 | 0.0371 | 0.0370 |
| Noah | 28.77 | 0.2877 | 0.2877 | 0 |
| **Total** | | **0.6495** | **0.4419** | **0.2076** |

`0.4419` = 1% of `F`; `0.2076` = 1% of the 20.76 refunded.

**Collecting up front is forced, not a convenience.** The fee cannot be billed
at clearing instead: a fully filled receipt has no refund to deduct it from,
and taking it out of `L` would break `L = F`.

Two implementation consequences:

- It **cannot reuse the `CreationFeeVault` shape**
  (collect → segregate → owner withdraws). The owner must never be able to
  withdraw money that may have to go back to traders.
- **Store the paid fee on the receipt. Do not derive it.** If `φ_in` is
  owner-configurable, deriving `φ_in · cost` at refund time repays the
  *current* rate on an *old* receipt.

### The withdrawal penalty

5% of the recorded cost of a withdrawn band, earned on the act and never
refunded — including on an owner cancellation. Because an unopposed band never
matched, the entry fee prepaid on it was never earned and returns with it, so a
withdrawing bettor pays **exactly 5%** of what they take back and nothing more.

It prices one narrow thing: moving the displayed odds and retracting them while
nobody responds. It is not buying solvency (Lemma 3 covers that) or
pump-and-withdraw protection (the lock rule forecloses it). Nothing inside the
mechanism calibrates the rate.

Mechanics (ADR 0014 P3): withdrawal is request-then-finalize, not instant. The
fee is one floored mulDiv on the request's whole gross — never per segment —
stamped at the request-time rate and never re-derived, and it lands in
`marketWithdrawalFeesEarned` when the request finalizes. A request voided
because its market was cancelled or missed graduation charges nothing: the
full receipt refunds instead, entry fee included.

## At graduation

The fee pot seeds the two v4 pools. Requiring each pool to balance at the
clearing price `p*` *forces* the split rather than leaving it to choice:

```
mint       Φ/2 complete sets            (costs Φ/2, yields Φ/2 YES + Φ/2 NO)
YES pool:  Φ/2 YES + (Φ/2)·p*       collateral
NO  pool:  Φ/2 NO  + (Φ/2)·(1 − p*) collateral
```

**Fees alone cannot fill this, at any rate.** Depth per side is `φ_in/2` as a
fraction of matched cap — 5% depth would demand a 10% entry fee. The pot is
therefore topped up from protocol capital to **10% of the graduation
threshold**, where the subsidy contributes roughly 9× what the fees do.

This is a subsidy of **market making**, not of **solvency**: complete sets stay
backed one-for-one and the collateralization theorem is untouched.

> **Seeded liquidity does not survive resolution.** A full-range position
> seeded at 35% ends worth ~88% of holding if it wins and **~5% if it loses**.
> Protocol liquidity must be unwound before resolution or it is a donation to
> arbitrageurs.

The creator takes **10% of the success fee** at graduation.

## Post-graduation: how the trading fee is actually collected

We use v4's own protocol-fee mechanism. **No hook code and nothing of ours runs
per swap** — both swap callbacks keep returning zero deltas.

### 1. Once, at venue deployment

`PoolManager` is deployed with `initialOwner = m.getAccount(0)`
(`protocol/ignition/modules/VenueStack.ts`). That owner is the only address
that may call:

```solidity
poolManager.setProtocolFeeController(controller);   // onlyOwner
```

The controller is then the only address that can set fees or sweep them.

### 2. Once per pool

```solidity
poolManager.setProtocolFee(poolKey, fee);           // onlyController
```

`fee` is a `uint24` packing **two directional fees**, 12 bits each —
`zeroForOne = fee & 0xfff`, `oneForZero = fee >> 12` — each capped at
`MAX_PROTOCOL_FEE = 1000` pips (0.1%). A symmetric 0.1% both ways is:

```
fee = 1000 | (1000 << 12) = 4_097_000
```

### 3. Every swap, automatically

`Pool.swap` reads the directional fee from `slot0`, takes it **from the input
amount first**, then applies the LP fee to the remainder
(`protocolFee + lpFee·(1 − protocolFee)`). The proceeds land in
`protocolFeesAccrued[currency]` on the PoolManager.

### 4. Periodically, sweeping

```solidity
poolManager.collectProtocolFees(recipient, currency, 0);  // 0 = sweep all
```

**Sweep in its own transaction.** The call reverts with
`ProtocolFeeCurrencySynced` if that currency is mid-sync, so it must not run
inside an unlock/settle cycle.

### Two things v4 will not do for you

**`collectProtocolFees` emits no event.** It transfers and returns. The money
paper-trail rule requires an immutable, receipt-linked record per value
transfer, so the controller must emit its own — which is one reason the
controller should be a contract rather than an operator EOA.

**Accrual is per currency, not per pool.** `protocolFeesAccrued` is
`mapping(Currency => uint256)`, so every market sharing a collateral token
pools into one bucket and there is **no on-chain link from a fee back to a
market or its creator**. The creator's ongoing share is therefore attributed
**off-chain** from indexed per-pool swap volume — reproducible from chain data,
but a trusted computation. The trustless alternative is a hook fee, rejected
because it would compete with the LP fee.

### The outcome-token trap

The fee is taken from the **input** currency. A buy pays collateral, so that
fee is collateral — but **a sell pays outcome tokens**, so roughly half of the
accrued fee is YES and NO. After resolution one of those is worth zero.

Policy: pair the accrued YES and NO and call `mergeCompleteSets` for exact
collateral — it is free and permitted any time before resolution
(`_requireNotTerminal`). Merge `min(YES, NO)` and dispose of the remainder.
**Outcome-token fees must not be left to sit until the market resolves.**

## What we deliberately do not charge

**A fee on `mintCompleteSets`.** Nothing forces the YES and NO pools to agree
that the two sides sum to one; a keeper arbitrage does, by minting sets when
they sum high and merging when they sum low. Every fee on that path widens the
band it cannot profit inside:

| Fees | `YES + NO` may sit in |
| --- | --- |
| none (today) | exactly 1 |
| 1% on swaps only | ±1.01% |
| 1% on swap + mint + merge | **±2.02%** |
| any, with the keeper exempt | exactly 1 |

A mint fee is also avoidable — buy from the pool instead — so it buys that
incoherence for nothing. **If a mint fee is ever added, the keeper exemption
ships in the same change.**

**A fee at resolution.** Solvent (the contract holds one unit per winning
share, so paying `1 − f` simply leaves `f` behind), but wrong on three counts:
it breaks the `1 YES ↦ 1` promise that separates a fixed-payout market from a
pari-mutuel pool; it weakens the §6 theorem from "zero deficit *and zero
surplus*" to "exact apart from the fee"; and it is **avoidable anyway**, since
`mergeCompleteSets` is gated only by `_requireNotTerminal()` and a holder can
buy the opposing leg and merge for full collateral at any time before
resolution. Closing that would mean fee-ing merge, which reopens the band
above.

## Invariants an implementer must preserve

1. `E = R + L + Φ`, and `E − Φ = R + L` over escrow alone. **No fee may come
   out of `L`, or be netted silently against refunds** — `L = F` has no slack,
   and an implicit fee breaks exact collateralization.
2. Fees earned pre-graduation equal `φ_in · F` exactly.
3. A market that fails to graduate, or is cancelled, returns every entry fee in
   full. Withdrawal penalties are kept in every case.
4. The graduation handoff path (`fundRetainedCollateral`, `mintRetainedSide`)
   is **never** feeable — it is the clearing output, not a trade.
5. Every fee movement — collection, refund, sweep, creator payout — leaves an
   immutable on-chain-sourced record.

## Open

- `φ_in`, `φ_out`, the 10% seeding cap and the creator's 10% are judgement
  calls, not derived optima.
- Seeding sized off the graduation threshold makes depth anti-proportional to
  success (5× threshold → 2% of cap). Sizing off `F` is a one-input change.
- Third-party pre-graduation subsidy: at 80% of a 1% fee it break-evens above
  ~6× the graduation target in volume *if held to resolution*, and profits at
  any volume if unwound before it.
- Charging `φ_out` on withdrawn *width* rather than cost would target display
  manipulation better.
