# Pop Charts project review

<!-- markdownlint-disable MD013 -->

- Review date: 2026-09-01
- Repository state reviewed: `a4703432` on `main` plus the Rust simulation working tree
- Primary mechanism specification: [whitepaper v0.6](whitepaper/v0.6.md)
- Previous review: [project review from 2026-07-29](project_review_2026-07-29.md)
- Overall project and readiness score: 79/100

## Result

Pop Charts has advanced from a strong local prototype to a broad, internally coherent launch candidate, but it is not ready for material public funds. The current repository now contains a canonical whitepaper source, an implemented pre-graduation withdrawal mechanism, an explicit fee model, complete withdrawal event accounting, a comprehensive local lifecycle suite, and a reproducible local Arc-compatible chain stack.

The principal unresolved risk is economic rather than algebraic. Pre-graduation withdrawals safely return only unopposed capital, so they do not provide a general exit. The post-graduation venue remains dependent on real LP or maker inventory. A new equal-capital simulation quantifies exit and provider-risk tradeoffs, but synthetic flow does not show that expected fees can attract inventory or that protocol seeding can survive observed terminal market flow. Security review and production deployment also remain incomplete.

The score rose from 74 to 79 because specification quality, withdrawal mechanics, fee accounting, lifecycle coverage, and local operations materially improved. The new simulation improves evidence but does not change the readiness score because the public-capital gates remain open: the security findings catalogue is still empty, the checked-in deployment registry contains no contract addresses, withdrawal lacks a user-facing app path, the capital policy remains unsettled, and provider returns have not been calibrated against observed flow.

## Changes since the July review

| July finding | Current status | Consequence |
| --- | --- | --- |
| Whitepaper v4 was stale and unchanged | Whitepaper v0.6 is the canonical in-repo Markdown source | The mechanism, withdrawals, and fee treatment can now change in reviewed source alongside code |
| Pre-graduation receipts had no exit | Unopposed-band withdrawal is implemented, tested, and indexed | Users can recover capital that was certain to refund without changing graduation or other fills |
| Fee treatment was unresolved | Entry, withdrawal, and post-graduation protocol fee mechanisms are specified and built, but disarmed | Solvency accounting is explicit; rate calibration and operations remain open |
| Lifecycle coverage was broad but incomplete | The nightly service and chain suite and five UI journeys cover all principal terminal paths | Integration risk is lower and money movements are reconciled end to end |
| Local stack setup was fragmented | `just local-dev` now launches a controlled full stack, and the Arc-compatible local chain is integrated | Local reproduction and failure drills are substantially better |
| Withdrawal and fee paper trail did not exist | Seven withdrawal events and the entry-fee ledger are indexed and reconciled | The new value-transfer path follows the repository's receipt-linked accounting invariant |
| Post-graduation liquidity was unresolved | A 1.8-million-venue-trial equal-capital simulation now measures exits and provider P&L, but seeding and unwind remain unbuilt | Concentrated inventory improves small exits but loses availability under directional flow; fee-only depth remains unusable |

## Current specification

The answer to the earlier whitepaper question is now yes. [Whitepaper v0.6](whitepaper/v0.6.md) is current and [protocol ADR 0002](protocol/docs/adr/0002-treat-whitepaper-v4-as-mechanism-source.md) designates the newest in-repo revision as the mechanism source of truth. Earlier PDFs are historical artifacts. There is not yet a committed v0.6 PDF.

Version 0.6 adds three material mechanism decisions:

1. receipt bands become withdrawable only where no opposite-side receipt covers them;
2. entry and withdrawal fees remain outside receipt escrow and have separate earning and refund rules;
3. fee revenue is proposed as post-graduation v4 seed capital.

The whitepaper and [protocol ADR 0014](protocol/docs/adr/0014-pre-graduation-withdrawals-and-fees.md) are generally aligned. The main live policy question is post-graduation seeding. Current `main` proposes a fee pot topped up with protocol capital and a required pre-resolution unwind. Open PR #554 proposes removing the protocol-capital top-up while retaining fee-only seeding. Neither seeding nor unwind is implemented, so the repository has time to settle this without migrating deployed state.

## Project status by layer

| Layer | Current evidence | Readiness judgment |
| --- | --- | --- |
| Pre-graduation market | Virtual-LMSR receipt placement, entry-fee escrow, segmented receipt support, cancellation, refunds | Substantive and heavily tested |
| Pre-graduation withdrawal | Off-chain quote and claim construction, optimistic request, constant-time refutation, finalization, fee accounting, seven indexed events | Contract and indexer path delivered; app path absent; manager trust remains |
| Graduation clearing | Deterministic band-pass clearing, largest-remainder rounding, Merkle commitments, keeper settlement, randomized and lifecycle tests | Strong local implementation with a trusted manager boundary |
| Post-graduation claims | Fully backed complete sets, mint and merge, resolution, cancellation, redemption | Broadly implemented in the current architecture |
| Trading venue | Two bounded v4 pools, maker orders, protocol-fee controller, complete-set arbitrage paths | Functional locally; usable depth and provider economics unproven |
| Resolution | Bonded proposal, dispute, corroborated AI workflow, finalization, cancellation and redemption paths | Broad implementation; disputed authority and incentive calibration remain centralized |
| App | Real indexed market flows, creation, trading, lifecycle and terminal UI journeys | Meaningful local product; no withdrawal UI found |
| Indexer and API | Event-sourced market, receipt, fee, withdrawal, resolution, and value-transfer projections | Strong local accounting; production resilience still needs deployment evidence |
| Local operations | Process Compose stack, Arc local node, controlled services, failure drills, lifecycle nightly | Reproducible and unusually complete |
| Production deployment | Arc testnet scripts and configuration exist | Checked-in local and Arc testnet contract maps are empty |
| Security | Static-analysis program, audit skill, invariant and lifecycle testing | Findings index remains empty and no external audit was evidenced |

## Mechanism assessment

### The withdrawal rule preserves clearing

Whitepaper v0.6 improves pre-graduation capital efficiency without inventing a market-maker reserve. An unopposed band contributes zero matched cap. Refunding its path cost and removing it from live support therefore leaves matched cap, locked collateral, and every other user's allocation unchanged.

This is materially safer than unrestricted cancellation or a whole-receipt reverse trade. A large holder cannot withdraw matched bands to veto graduation, and a trader who attracts an opposite-side response cannot retract the overlap after the response arrives.

The implementation uses segmented receipt support because an interior withdrawal can split an interval. The off-chain service computes the free set, while the contract can refute a false absence claim when a challenger names one covering opposite receipt. The design avoids on-chain enumeration but inherits the manager and watcher assumptions already present in graduation clearing.

### The withdrawal is useful but narrow

ADR 0014 reports that about 15% of escrow became withdrawable in its random-book study and about 86% remained locked. This is consistent with the mechanism's purpose: release bands that cannot possibly clear while committing bands where another user has taken the other side.

Three product risks remain:

- a user may interpret withdrawal as a general sell function and discover that most capital is locked;
- extreme-price receipts can be pinned by comparatively cheap complementary trades;
- the manager-only request path with a zero default challenge period makes availability and correctness operational services rather than independent user powers.

The app should expose current opposing coverage, withdrawable gross and net value, the fee, and clear pending, refuted, voided, and finalized states before the mechanism is armed for users.

### Fee accounting is coherent

The entry fee is collected on placement but earned only on retained cost. The unearned part returns with every refund. The withdrawal fee is earned only when an early withdrawal finalizes. Neither is netted out of retained collateral, preserving:

```text
escrow = retained collateral + refunds
entry fee held = entry fee earned + entry fee refunded
```

The intended 1% entry fee and 5% withdrawal fee are judgment values rather than calibrated optima. Both ship at zero. This is the correct deployment posture until simulation and observed testnet behavior distinguish honest early recovery from display manipulation.

## Post-graduation liquidity assessment

### Fee-only seeding cannot provide reliable exits

At a 1% entry fee, pool depth per side is 0.5% of matched cap. The fee model's worked example shows that this is too shallow for even a small holder exit. A fee-only seed can keep a pool from opening empty, but it cannot be described as usable market depth.

The current protocol-capital top-up tries to reach more meaningful depth, but it creates a recurring treasury cost and requires the position to be removed before resolution. The proposed amendment in PR #554 drops that top-up and makes third-party liquidity explicitly load-bearing. That is more sustainable for the protocol, but only if makers have a credible return model and actually arrive.

The Rust comparison confirms the scale problem. At a fresh 35% opening, selling outcome equal to 1% of matched cap through fee-only depth incurred 7,307 bps of slippage. With one total risk budget equal to 10% of matched cap, the same exit cost 181 bps through the concentrated range and 376 bps through the funded scoring maker.

### LP fees do not prove LP profitability

Giving the full LP fee to liquidity providers is internally consistent. It avoids making private liquidity permanently dependent on a protocol subsidy. It does not show that fees compensate informed order flow, terminal inventory loss, rebalancing, gas, capital duration, and resolution risk.

The project should compare provider terminal P&L rather than impermanent loss alone. Outcome tokens converge to zero or one, so a broad LP position can finish holding the losing side even while having collected substantial fees.

The first comparison now does this under declared synthetic flows. Concentrated, maker, hybrid, and funded policies all had negative mean terminal returns under informed flow, while the broad pool earned 1.80% on average but lost 25.53% at the fifth percentile. Under a probability shock every equal-capital policy had a negative mean. These numbers are mechanism evidence, not return forecasts, because flow is not fitted to observed users and the model omits gas, rebalancing, keeper latency, and unwind.

### A funded LMSR guarantees quotes but does not dominate the current venue

A conventional funded LMSR offers deterministic quote availability with a known sponsor loss bound, but requires separate capital of `b ln(2)` for a neutral binary market. In the equal-capital comparison it filled every finite exit and maintained one coherent binary price. At a fresh 35% market it quoted worse than concentrated liquidity but better than broad liquidity, and it exposed 53.06% of sponsor capital at the fifth percentile under informed flow and 85.37% under a probability shock. This supports retaining it as the quote-availability benchmark, not replacing the current venue.

## Highest-priority risks

### P0 - Settlement of the post-graduation capital policy

Decide whether the protocol supplies no seed, fee-only seed, or bounded additional capital. Specify range selection, ownership, unwind timing, missed-unwind behavior, and the source of usable third-party depth. Resolve the open ADR amendment before building P5 or P6.

### P0 - User-facing withdrawal completion

Build and exercise the quote and request journey through the app and real service. Include pending and failure states and reconcile the final user-visible balance against indexed events. The contract feature should not be armed before its operational and product path exists.

### P0 - Extend the completed economic baselines with operational and observed flow

The Rust engine now covers withdrawable fraction, book-size sensitivity, pinning, display retraction, fee bases, and an equal-capital post-graduation comparison. The pre-graduation run found that 64-receipt withdrawable escrow ranged from 0.68% under informed flow to 67.24% under one-sided flow. The post-graduation run found that concentrated depth improves small exits but can exhaust, while a funded scoring maker guarantees finite quotes by reserving loss capital.

Two extensions remain:

1. interleaved withdrawal requests, refutations, watcher outages, graduation timing, and adversarial fragmentation;
2. observed-flow replay plus Q96 rounding parity, keeper limits and latency, gas, LP repositioning, and pre-resolution unwind for the completed equal-capital study.

### P0 - Security review for public capital

Complete the fixed audit catalogue, record negative results as well as findings, triage every value-transfer and privilege surface, and obtain independent review before raising caps. The new withdrawal library, optimistic claim path, fee escrows, fee controller, graduation handoff, and terminal unwind deserve explicit coverage.

### P0 - Rehearsed deployment evidence

Deploy the full stack to the intended test environment and persist contract addresses, code hashes, effective fee and challenge settings, service identities, and monitoring. Run the full lifecycle and failure drills against that environment. Local completeness does not establish production key control, RPC behavior, or recovery.

### P1 - Parameter calibration

Calibrate `b`, graduation threshold, entry fee, withdrawal fee, concentration gates, and time gates jointly. Measure graduation probability, matched cap, user capital duration, manipulation cost, and post-graduation depth across realistic market categories.

### P1 - Resolution and operator trust

The mechanism now depends on trusted or semi-trusted services at withdrawal, graduation, evidence collection, and disputed resolution. Document the current authority boundary plainly, then decide which roles need challenge windows, redundant operators, or deliberately low deployment caps.

## Research program

The updated [research memo](research.md) specifies the experiments in detail. The recommended order is:

1. add withdrawal UI and instrumentation so the shipped mechanism can produce evidence;
2. calibrate the synthetic pre-graduation flow models against observed testnet behavior;
3. add challenge-window and interleaved-withdrawal experiments;
4. settle P5 and P6 policy before implementing either;
5. calibrate the completed equal-capital venue comparison against observed flow and operational constraints;
6. use observed provider P&L to decide whether third-party liquidity is plausible;
7. calibrate launch parameters and product language from those results.

The previous 600,000-state capped reverse-trade simulation should be retained only as an alternate-mechanism result. It tested a design the project did not choose. Updating it is lower priority than testing the mechanism now in contracts.

## Scorecard

| Category | Weight | Score | Assessment |
| --- | --: | --: | --- |
| Mechanism soundness | 20% | 95 | v0.6 adds a proved withdrawal invariant without weakening exact collateralization |
| Implementation fidelity | 15% | 92 | Withdrawal, fee, clearing, and terminal paths closely track ADR decisions |
| Lifecycle completeness | 15% | 91 | Broad service, chain, and UI journeys cover principal terminal states and failure drills |
| Economic completeness | 15% | 58 | Fee accounting is clear, but usable depth and provider return remain unproven |
| Security and trust model | 15% | 60 | Strong testing and explicit boundaries; audit catalogue and independent review remain open |
| Product and deployment readiness | 10% | 58 | Reproducible full local stack; no withdrawal UI or evidenced deployed contract registry |
| Testing and observability | 10% | 94 | Property, contract, indexer, lifecycle, reconciliation, and failure coverage are unusually broad |
| Weighted total | 100% | 79 | Strong launch candidate; not ready for material public capital |

## Bottom line

Pop Charts has answered the narrow pre-graduation withdrawal question well. Virtual liquidity still cannot buy profitable positions back, but the protocol can return unopposed capital because that capital was already guaranteed to refund. The implementation preserves graduation and other users' fills and leaves an auditable value-transfer trail.

The project has not answered the broader exit promise. Opposed capital remains locked before graduation, and post-graduation exits depend on independently supplied inventory. The equal-capital study shows that concentrated liquidity buys better small exits while funded scoring liquidity buys guaranteed finite quotes, but neither creates free liquidity or a proven provider business. The next useful work is to finish the user path, observe strategic withdrawal and trading behavior, settle the seeding policy, and add operational realism to the venue benchmark. Security review and a rehearsed deployment remain gates before meaningful public funds.
