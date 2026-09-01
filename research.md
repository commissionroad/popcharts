# Virtual-to-Backed Market Design Research

<!-- markdownlint-disable MD013 -->

Research status: updated 2026-09-01 against repository commit `a4703432`, whitepaper v0.6, protocol ADR 0014, and the implemented withdrawal and fee stack.

## Executive answer

Pop Charts now has a coherent pre-graduation exit mechanism. A user may withdraw only the bands of a receipt that no live opposite-side receipt covers. Those bands were guaranteed to refund at clearing, so returning their recorded path cost early does not require market-maker capital, change matched market cap, alter another user's fill, or weaken graduation solvency.

This is narrower than selling a position. In the random-book study recorded by ADR 0014, about 15% of escrow was withdrawable and about 86% of the book remained locked. Once another user covers a band from the opposite side, that band is committed until graduation, cancellation, or expiry. The product should describe this as early recovery of unopposed capital, not as a reliable pre-graduation exit.

The implemented design supersedes the whole-receipt capped reverse trade that this memo previously treated as the leading candidate. That alternate rule remains mathematically interesting, but it would change the current clearing incentives and permits a trader to create a temporary price signal and recover principal after others follow. It should remain a counterfactual unless the narrower withdrawal mechanism proves inadequate in observed use.

The larger liquidity problem remains unresolved after graduation. Fully backed YES and NO claims guarantee terminal redemption, but they do not guarantee an executable sale before resolution. The current two-pool v4 venue needs real LP or maker inventory. Whitepaper v0.6 proposes seeding it from fees plus protocol capital, but ADR 0014 phases P5 and P6 are not built, and open PR #554 proposes dropping the protocol-capital top-up while retaining only the small fee-funded seed. At a 1% entry fee, that seed provides only 0.5% of matched cap per pool side, so third-party liquidity would be the load-bearing source of depth.

The recommended direction is:

1. keep the implemented unopposed-band withdrawal rule and finish its user-facing path;
2. validate its economics and operating assumptions instead of rerunning its already-covered solvency theorem;
3. keep the current v4 venue as the implementation default while measuring actual exit depth and maker P&L;
4. treat a funded post-graduation LMSR as an equal-capital benchmark, not as the next implementation;
5. do not promise reliable exits until the product names an exit size, slippage bound, and committed source of real capital.

## 1. The current mechanism

### 1.1 Virtual LMSR prices intent rather than funded claims

The pre-graduation state uses:

```text
C(q_yes, q_no) = b ln(e^(q_yes/b) + e^(q_no/b))
```

The parameter `b` controls how smoothly the displayed probability moves. It is not a deposited reserve or market-maker loss budget. A buyer escrows the exact path cost and receives a receipt covering the traversed interval. Each receipt segment later becomes either:

- a retained, fully backed outcome claim where both sides covered the same band; or
- a refund at its recorded path cost where it did not clear.

There is no protocol counterparty promising to buy a receipt at the current virtual price.

### 1.2 Band-pass clearing creates backing

For every retained band:

```text
YES path cost + NO path cost = band width
```

The clearing sweep retains equal YES and NO share counts over each covered band. Their combined escrow equals one unit of collateral per complete set, producing:

```text
escrow = retained collateral + refunds
locked collateral = retained matched cap
```

This guarantees the maximum resolution liability. It does not leave spare collateral that can also buy outcome claims from users.

### 1.3 Backing and liquidity remain different guarantees

| Guarantee | Current mechanism |
| --- | --- |
| A valid winner can redeem after resolution | Yes, for graduated claims |
| Unopposed pre-graduation capital can return early | Yes, through the withdrawal mechanism |
| Opposed pre-graduation capital can exit | No |
| A post-graduation user always receives an executable sale quote | Only when venue inventory exists |
| A user can sell a specified size within bounded slippage | Not currently promised or funded |

## 2. Implemented pre-graduation withdrawals

### 2.1 Only unopposed bands may leave

A receipt band is opposed when any live opposite-side receipt covers it. Opposed bands lock for both receipts. Every unopposed band may be withdrawn for its own recorded path cost, less the withdrawal fee.

For an unopposed YES band, the opposite count is zero both before and after withdrawal:

```text
before: matched count = min(Y, 0) = 0
after:  matched count = min(Y - 1, 0) = 0
```

The band contributes nothing to matched cap in either state. Removing it therefore leaves the graduation decision, locked collateral, and every other receipt's clearing allocation unchanged.

This is the stable version of Matt's suggestion to release the amount that has not matched. It does not use the provisional refund produced by freezing the book today. Same-side crowding can change that provisional amount later. It releases only bands with no opposite coverage, which were already certain to refund.

### 2.2 The rule prevents the graduation veto

Unrestricted receipt withdrawal would let a large holder erase matched cap and prevent graduation. The unopposed-band rule removes only segments contributing zero matched cap, so no withdrawal can move a market above or below its graduation threshold.

It also blocks the most direct pump-follow-withdraw strategy. Once another user responds on the opposite side, the overlapping range locks. A trader may still move the display and retract the move while nobody responds, but cannot recover the opposed portion after inducing a counterparty to trade.

### 2.3 The exit remains limited

The current rule has four material costs:

- ADR 0014 reports about 15% of escrow withdrawable across its random books, leaving most active capital locked.
- Another user can pin a receipt by taking the opposite side. At extreme prices, the complementary trade can be cheap relative to the amount it locks.
- Withdrawing an interior band fragments a receipt. The contract caps stored segments at eight, while the existing random study observed at most two.
- The app does not yet expose the withdrawal flow, even though quoting, contracts, generated ABI, event ingestion, and reconciliation have landed.

The mechanism improves capital efficiency at the unopposed edges. It is not a secondary market and does not provide reliable exits from a live two-sided market.

### 2.4 The optimistic request path adds an operating assumption

The contract cannot enumerate every receipt for a market on chain. The service therefore computes free segments off chain and submits a withdrawal request. A challenger can refute a false claim by naming one opposite-side receipt, which the contract checks in constant time.

The current operating posture uses a manager-only requester and a challenge period that defaults to zero. This matches the trusted clearing service but means the user is not independently submitting a trustless proof. If the challenge window is armed later, the design inherits an honest-watcher assumption for each request.

The main operational questions are therefore service availability, false-claim detection, watcher downtime, pending-request handling at graduation, and user-visible recovery when a request is refuted or voided.

## 3. Fees preserve the solvency identity

### 3.1 Entry fee

The intended entry fee is 1% of receipt cost. It is collected up front but earned only on retained cost at graduation. The unearned portion returns with refunds, including withdrawal and failed-graduation paths.

```text
entry fees earned = entry fee rate * matched cap
```

This fee is a second escrow, not protocol revenue at placement. The implementation stores the paid fee on each receipt so a later rate change cannot alter the amount owed back.

### 3.2 Withdrawal fee

The intended withdrawal fee is 5% of the recorded cost withdrawn. It is earned when the request finalizes. The user also receives the entry fee prepaid on that unopposed cost, because it never matched.

The rate is not derived from an economic optimum. Charging on cost may underprice manipulation of cheap extreme-price bands because path width, not cost, determines display movement. Charging on width would target that behavior more directly, but should be tested before changing the fee basis.

### 3.3 Post-graduation protocol fee

The v4 protocol-fee controller supports the native 0.1% fee. LP fees remain entirely with LPs, no hook fee is added, and complete-set minting remains free so keeper arbitrage can preserve price coherence.

All three market fees currently ship disarmed:

| Fee | Intended rate | Implementation state |
| --- | --: | --- |
| Entry | 1% of receipt cost | Built and indexed; rate defaults to zero |
| Withdrawal | 5% of withdrawn cost | Built and indexed; rate defaults to zero |
| Post-graduation protocol | 0.1% of swap input | Built; rate defaults to zero |

## 4. Post-graduation liquidity remains unresolved

### 4.1 The current venue

The implemented venue uses:

- one YES/collateral v4 pool;
- one NO/collateral v4 pool;
- bounded outcome prices;
- complete-set mint and merge;
- one-sided maker orders represented as concentrated liquidity;
- a keeper path for cross-pool price coherence.

Every executed swap uses real inventory. The venue can aggregate independently funded LP ranges and maker orders, but it offers no quote where usable liquidity is absent.

### 4.2 Fee-only seeding is too shallow to carry the venue

Whitepaper v0.6 and ADR 0014 derive the balanced seed split. If `Phi` is the pre-graduation fee pot, each side receives depth `Phi / 2`. Since the entry fee is earned only on matched cap `F`:

```text
depth per side as fraction of F = entry fee rate / 2
```

At a 1% entry fee, each side receives depth equal to 0.5% of matched cap. ADR 0014's worked example has a sale equal to 1% of a holder's position moving a 35% price to about 3.9% under that fee-only seed.

The current main branch still proposes topping the seed up to 10% of the graduation threshold with protocol capital and withdrawing it before resolution. Neither phase is implemented. Open PR #554 proposes retaining the fee-funded seed while dropping the protocol-capital top-up. If that lands, third-party LPs and makers explicitly become the load-bearing source of usable depth.

### 4.3 Protocol seeding has terminal risk

A v4 position in a binary outcome market is exposed to informed flow as probability approaches zero or one. ADR 0014 estimates that a full-range position seeded at 35% ends near 88% of hold if YES wins and near 5% if YES loses. The exact result depends on range and path, but the mechanism is structural: arbitrageurs remove the appreciating outcome and leave the pool holding the outcome approaching zero.

Any protocol seed therefore needs a tested pre-resolution unwind or bounded range policy. A smaller fee-only seed reduces absolute loss but does not remove the operational requirement.

### 4.4 Rational LP participation is still unproven

The relevant LP return is:

```text
terminal redeemed value
+ remaining collateral
+ fees and incentives
- initial marked value
- gas, rebalancing, and opportunity cost
```

Impermanent loss alone does not measure the outcome-token inventory that becomes worthless or the adverse selection near resolution. LP participation is rational only if expected fees and incentives compensate those risks relative to other uses of capital. The repository contains a fee policy but not evidence that likely volume supports that return.

## 5. Funded post-graduation LMSR remains a benchmark

A conventional funded LMSR can always quote a finite sale. For a neutral binary opening, its maximum sponsor loss before fees is:

```text
reserve = b ln(2)
```

That reserve is additional risk capital. It cannot be taken from collateral already backing outstanding outcome claims.

The funded LMSR offers one coherent probability, deterministic quote availability, and an explicit sponsor loss bound. It also requires capital for every market, concentrates market-making risk in the sponsor, adds custom security-critical math and custody, and still gives severe slippage under one-sided flow.

| Dimension | Funded post-graduation LMSR | Current v4 venue |
| --- | --- | --- |
| Source of exit cash | Sponsor reserve plus trading cash | LP and maker inventory |
| Quote availability | Every finite trade | Only where active inventory exists |
| Slippage | Smoothly worsens toward zero | Depends on active ranges and orders |
| Capital loss | Explicit bounded-loss strategy | Bounded by deposits but path-, range-, and outcome-dependent |
| Price coherence | Native YES + NO = 1 | Maintained by mint/merge arbitrage |
| Maker flexibility | One curve and one `b` | Multiple ranges and one-sided orders |
| Low-volume cost | Sponsor reserve sits idle | Makers may decline or withdraw |
| Implementation | New custom maker | Existing venue and order manager |
| Limit orders | Requires order lifecycle and executor | Already represented by maker liquidity |

The equal-capital experiment did not justify replacing the current venue. It showed that a funded LMSR guarantees finite quotes, but concentrated liquidity gives better small-exit pricing while active and the funded maker exposes nearly its whole sponsor budget in adverse tails. Keep the LMSR as the quote-availability benchmark unless observed-flow replay changes that tradeoff enough to justify a new audited market-maker surface.

## 6. Simulation decision

### 6.1 The old 600,000-state simulation becomes an alternate-design result

The prior simulation tested whole-receipt capped reverse trades and fee-funded conversion into a real LMSR. It found no accounting failure across 600,000 intermediate states, but it does not validate the mechanism now implemented upstream.

Do not expand it as the main next experiment. Preserve its result as a counterfactual showing that another accounting shape may be solvent. Revisit it only if observed users need exits from opposed capital badly enough to justify changing the mechanism.

### 6.2 Existing upstream tests already cover the core withdrawal invariant

The repository already includes:

- 398 seeded random-walk books where withdrawing every quoted free band leaves matched cap bit-identical;
- a largest-holder withdrawal study over 400 books;
- golden quotes from whitepaper v0.6;
- randomized opposition, fragmentation, and claim prototypes;
- Solidity tests for request, refutation, finalization, cancellation, fee accounting, and race conditions;
- indexed paper-trail reconciliation for the seven withdrawal events.

Repeating the same random-walk invariant at a larger sample count would add little. The theorem is simple and the implementation has direct property coverage. New simulation should target assumptions that the theorem does not answer.

### 6.3 Withdrawable capital depends on flow and book age

The first Rust experiment asked whether ADR 0014's roughly 15% withdrawable-escrow result survives different flow models and larger books. It does not as a general percentage. Across 6,250,000 invariant-checked books, the mean ranged from 0.31% for 128-receipt informed books to 67.48% for 128-receipt one-sided books. Balanced noise reproduced approximately 15% at 16 receipts, then fell to 4.84% at 64 receipts and 2.71% at 128.

The run used seed `0x00c0ffee`, 250,000 trials for every scenario and receipt-count cell, opening paths uniform from `-2b` to `2b`, and trade widths uniform from `0.05b` to `0.75b`. Every trial checked the exact integer path partition, signed path state, and matched-cap invariance after removing all free bands. The machine-readable result is [pregrad-withdrawal-v1.json](simulation/results/pregrad-withdrawal-v1.json).

Mean withdrawable escrow as a percentage of total receipt cost:

| Flow model | 8 receipts | 16 receipts | 32 receipts | 64 receipts | 128 receipts |
| --- | ---: | ---: | ---: | ---: | ---: |
| Balanced noise | 24.29% | 14.46% | 8.44% | 4.84% | 2.71% |
| Momentum-following | 45.51% | 30.39% | 19.24% | 11.60% | 6.73% |
| Informed around a moving latent probability | 8.09% | 3.47% | 1.52% | 0.68% | 0.31% |
| 85% one-sided demand | 65.83% | 65.74% | 66.77% | 67.24% | 67.48% |
| Mixed noise, momentum, and informed | 19.80% | 9.80% | 4.43% | 1.79% | 0.67% |

The 64-receipt distributions show why the mean alone is insufficient:

| Flow model | Withdrawable escrow mean | Median | 95th percentile | Receipts with any withdrawable capital | Matched width | Receipts retractable immediately after placement |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Balanced noise | 4.84% | 1.71% | 19.43% | 4.86% | 44.41% | 25.25% |
| Momentum-following | 11.60% | 6.56% | 39.76% | 9.84% | 41.06% | 34.02% |
| Informed | 0.68% | 0.00% | 4.20% | 0.96% | 47.55% | 17.41% |
| One-sided | 67.24% | 68.15% | 85.02% | 64.52% | 15.01% | 74.89% |
| Mixed | 1.79% | 0.00% | 9.93% | 1.85% | 46.74% | 22.07% |

The withdrawal mechanism is most useful in one-sided markets, where capital otherwise waits for expiry and matched width is low. It becomes less available precisely where two-sided or informed trading makes the market more likely to graduate. In the 64-receipt informed model, the median book had no withdrawable escrow at all.

Immediate retraction is much more common than final-snapshot withdrawal. In balanced 64-receipt books, 25.25% of placements had some retractable range immediately, while only 4.86% of receipts still had any withdrawable capital at the final snapshot. The generator does not model repeat receipts by the same owner, so this is receipt-weighted rather than user-weighted. Opposition closes the retraction window as the book develops. Interfaces should therefore quote withdrawal continuously rather than imply that a receipt has a stable withdrawable balance.

The largest remaining segment count was two in every one of the 6,250,000 books. This supports the current eight-segment contract cap under the simulated sequential-path model, but does not test repeated interleaved partial withdrawals designed to maximize fragmentation.

### 6.4 Cost- and width-based fees do not yet yield a calibrated rate

The simulation compared 0%, 1%, 2%, and 5% cost-based fees with a width-based fee at the same nominal rate, capped at the withdrawn gross cost. Width charging penalized cheap, display-moving bands more strongly. At 64 receipts and a nominal 5% rate, its effective fee was 6.10% of gross withdrawal in balanced flow, 6.70% in informed flow, and 6.27% in mixed flow, compared with exactly 5% under cost charging.

For balanced 64-receipt flow, a 5% cost fee charged an aggregate `0.00335b` per percentage point of immediately retractable display movement. The 5% width fee charged `0.00427b`, about 28% more. At `b = 5,000`, those averages scale to about 16.72 and 21.34 collateral per percentage point. A strategic attacker can select cheaper bands than the average, so these are comparative measurements rather than manipulation bounds.

The pinning grid confirms the extreme-price asymmetry. Locking a YES receipt spanning 90% to 95% requires a covering NO receipt costing only 7.80% as much as the YES receipt: `0.0541b` against `0.6931b`. At `b = 5,000`, that is about 270 collateral to pin about 3,466 of victim cost. The low-price case is symmetric for pinning NO. The action is a real opposing trade, but the option to lock another user's withdrawal is cheap near an extreme.

No simulated result makes 5% the correct withdrawal rate. The rate trades honest impatience against retractable display manipulation, whose external harm the model does not price. Width charging targets the mechanism more directly, but also charges honest extreme-price users more. Testnet behavior or an explicit manipulation-loss function is still required.

### 6.5 Correctness and performance baseline

The Rust engine keeps path geometry and matched cap in exact integer micro-`b` units and isolates LMSR softplus pricing behind the same coordinate-rounded shape used by the TypeScript implementation. A generated parity fixture compares 64 canonical TypeScript books containing 1,293 receipts against Rust for exact coordinates, free segments, matched cap, and normalized path costs.

The recorded release run evaluated 310,000,000 receipts in 7.69 seconds on 32 threads, about 40.3 million receipts per second, while checking the withdrawal invariant on every book. A separate 64-receipt balanced run produced the same economic result at 1, 8, and 32 threads and scaled from 2.23 million to 40.0 million receipts per second. Thread scheduling does not enter trial seeds or aggregation order.

The current experiment remains synthetic. It does not yet model interleaved finalized withdrawals, challenge-window watcher outages, request queues at graduation, gas, duplicate-market demand splitting, or observed user flow. Those are extensions of the same engine, not reasons to reinterpret this result as field evidence.

### 6.6 Equal-capital post-graduation simulation

The first post-graduation Rust experiment compared six inventory policies across 300,000 generated markets and 1,800,000 venue trials. Every non-fee-only venue received one total capital budget equal to 10% of normalized matched cap, split across both outcome pools where applicable. The fee-only venue received 0.5%, matching the depth available from a 1% entry fee. Each trial replayed the same 128 user trades and resolution draw through every venue.

The pool engine uses continuous concentrated-liquidity formulas rather than a constant-product approximation. It traverses range boundaries, accounts separately for the 0.30% LP fee and armed 0.10% protocol fee in the input currency, and runs ideal complete-set arbitrage after every user trade. The funded scoring maker uses the same 10-unit total risk budget, with `b` chosen from the opening probability so its worst-case binary loss equals that budget. Every transition checked outcome and collateral conservation; the maximum absolute error across 230,400,000 user-trade attempts was `4.36e-9` normalized units. The machine-readable result is [postgrad-liquidity-v1.json](simulation/results/postgrad-liquidity-v1.json).

At a fresh 35% opening, concentrated liquidity gave the best sell execution for every tested size because all 10 units were active in the 25-spacing range. The funded scoring maker paid slightly less on a 0.1%-of-cap exit, but degraded more slowly than the broad pool as size increased.

| Exit size as percentage of matched cap | Fee-only seed | Broad pool | Concentrated pool | Maker ladder | Broad-plus-maker hybrid | Funded scoring maker |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.1% | 2,157 bps | 173 bps | 54 bps | 78 bps | 86 bps | 74 bps |
| 0.5% | 5,760 bps | 669 bps | 111 bps | 226 bps | 265 bps | 209 bps |
| 1.0% | 7,307 bps | 1,224 bps | 181 bps | 402 bps | 478 bps | 376 bps |
| 2.0% | 8,443 bps | 2,157 bps | 319 bps | 732 bps | 869 bps | 705 bps |
| 5.0% | 9,313 bps | 4,052 bps | 709 bps | 1,566 bps | 1,831 bps | 1,638 bps |

Fresh-book depth hides range exhaustion. Across sequential synthetic flow, the funded scoring maker and broad pool filled every requested exit. The funded maker has a mathematical all-finite-trades quote guarantee; the broad pool achieved 100% only within these generated paths and finite epsilon bounds. Concentrated and maker-only inventory offered better prices while active but failed under sustained direction.

| Flow | Broad pool exit fill | Concentrated exit fill | Maker exit fill | Hybrid exit fill | Funded maker exit fill |
| --- | ---: | ---: | ---: | ---: | ---: |
| Noise | 100.00% | 97.97% | 98.44% | 100.00% | 100.00% |
| Informed | 100.00% | 95.52% | 96.54% | 100.00% | 100.00% |
| Exit wave | 100.00% | 24.22% | 27.53% | 93.71% | 100.00% |
| Probability shock | 100.00% | 88.45% | 90.30% | 100.00% | 100.00% |
| One-sided | 100.00% | 43.92% | 46.35% | 99.56% | 100.00% |
| Mixed | 100.00% | 96.93% | 97.63% | 100.00% | 100.00% |

Provider returns do not establish a rational-LP case. Under the common-reference informed flow, mean terminal return was `+1.80%` for the broad pool, `-4.90%` for the concentrated pool, `-3.89%` for maker ranges, `-3.50%` for the hybrid, and `-3.48%` for the funded maker. Their fifth-percentile returns were `-25.53%`, `-44.40%`, `-41.54%`, `-40.29%`, and `-53.06%`. Under a probability shock, every equal-capital policy had negative mean return: the broad pool lost `1.73%`, the concentrated pool `15.49%`, maker ranges `13.90%`, the hybrid `12.75%`, and the funded maker `15.19%`. Fee income did not compensate those synthetic adverse flows.

The first experiment supports keeping the current venue while treating its liquidity promise honestly. Concentrated positions and maker orders are capital-efficient for small exits but cannot guarantee availability. A funded scoring maker buys guaranteed finite quotes and one coherent probability at the cost of reserving loss capital on every market and exposing nearly the whole budget in adverse tails. The result does not justify replacing the current venue, but it does justify retaining funded LMSR as the quote-availability benchmark and rejecting fee-only seeding as usable depth.

The limits matter for the next decision. Order flow is synthetic and not fitted to testnet users. Pool math is continuous and omits Q96 integer rounding, gas, transaction ordering, keeper latency, arbitrageur capital limits, LP repositioning, pre-resolution unwind, and cancellation. The keeper is ideal and acts after every trade. The protocol fee is modeled armed even though deployment defaults remain zero. Provider returns therefore compare mechanisms under declared flows; they are not forecasts of commercial returns.

## 7. Prioritized research and delivery plan

### P0 - Finish and observe the shipped withdrawal path

Add the user-facing quote, request, pending, refuted, voided, and finalized states. Exercise the real UI path through a local lifecycle scenario. Instrument withdrawable fraction, requested value, finalization time, refutations, fee paid, and segments per receipt. This turns the existing contract mechanism into observable product evidence.

### P0 - Calibrate the synthetic flow models against observed behavior

The first economic run establishes sensitivity, not real-world frequencies. Instrument testnet receipt side, width, opening prior, time, opposition, withdrawal quote, request, and finalization. Fit or replay those distributions before setting fees or describing an expected withdrawable percentage.

### P0 - Add interleaved withdrawal and watcher experiments

Extend the Rust engine with request, refutation, finalization, and graduation timing. Vary watcher count, correlated outage duration, challenge period, false-claim strategy, request arrival bursts, and the eight-segment cap. Measure false finalization probability, honest delay, graduation blockage, gas-shaped operation counts, and maximum fragmentation.

### P0 - Settle the post-graduation capital policy

Resolve ADR 0014 P5 and P6 before implementing either. Decide whether Pop Charts supplies no capital, a fee-only seed, or a bounded additional seed. State who must unwind it, when, and what happens if the operator misses the window. Do not let an open documentation amendment silently become implementation policy.

### P0 - Calibrate and stress the completed equal-capital venue comparison

Replay observed testnet trades, add keeper latency and capital limits, Q96 rounding parity, gas, LP repositioning, and the required pre-resolution unwind. Preserve the current synthetic result as the first mechanism baseline rather than tuning its flows until one venue wins.

### P1 - Establish third-party maker economics from observed flow

The synthetic comparison found negative mean returns for concentrated, maker, hybrid, and funded policies under informed flow, and negative means for every equal-capital policy under a probability shock. Estimate the volume, fee rate, range management, and incentives required for competitive terminal P&L from observed flow. Treat fee revenue as one component of P&L, not proof of profitability.

### P1 - Calibrate `b`, threshold, and market gates jointly

Use realistic market categories and priors. Measure display sensitivity, graduation probability, matched cap, concentration, manipulation cost, and post-graduation depth. Development defaults are not product parameters.

### P1 - Define the product exit promise

Choose among best-effort displayed depth, guaranteed quote availability, or a specified sell size within a slippage bound. Only the last two require protocol-controlled capital. Product language and simulation acceptance criteria should use the same definition.

### P2 - Keep broader receipt exits as counterfactuals

Whole-receipt capped reverse trades, paired-receipt cancellation, and receipt transferability should remain outside the implementation roadmap until observed withdrawal data shows that unopposed-band recovery is insufficient. Any proposal must preserve matched cap, other users' allocations, refund ownership, and the money paper trail.

## Sources

### Pop Charts

- [Whitepaper v0.6](whitepaper/v0.6.md)
- [Whitepaper revision status](whitepaper/README.md)
- [Pre-graduation withdrawals and fees](protocol/docs/adr/0014-pre-graduation-withdrawals-and-fees.md)
- [Fee model](docs/fee-model.md)
- [Withdrawal quote](protocol/src/clearing/withdrawal-quote.ts)
- [Withdrawal claim verification](protocol/src/clearing/withdrawal-claim.ts)
- [On-chain withdrawal library](protocol/contracts/libraries/ReceiptWithdrawals.sol)
- [Current v4 market decision](protocol/docs/adr/0008-use-complete-set-erc20-v4-markets-on-arc-testnet.md)
- [Current v4 venue plan](protocol/docs/complete-set-v4-hook-order-manager-plan.md)
- [Rust simulation](simulation/README.md)
- [Initial pre-graduation result](simulation/results/pregrad-withdrawal-v1.json)
- [Initial post-graduation result](simulation/results/postgrad-liquidity-v1.json)

### Primary literature and upstream design

- Robin Hanson, [Logarithmic Market Scoring Rules for Modular Combinatorial Information Aggregation](https://mason.gmu.edu/~rhanson/mktscore.pdf)
- Yiling Chen and David M. Pennock, [A Utility Framework for Bounded-Loss Market Makers](https://arxiv.org/abs/1206.5252)
- Abraham Othman et al., [A Practical Liquidity-Sensitive Automated Market Maker](https://www.cs.cmu.edu/~sandholm/www/liquidity-sensitive%20automated%20market%20maker.teac.pdf)
- Uniswap Labs, [Uniswap v4 Core](https://app.uniswap.org/whitepaper-v4.pdf)
- Uniswap, [`v4-core`](https://github.com/Uniswap/v4-core)
