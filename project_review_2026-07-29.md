# Review - Pop Charts: current project and post-whitepaper architecture

<!-- markdownlint-disable MD013 -->

This review is a historical snapshot. The current assessment is [the 2026-09-01 project review](project_review_2026-09-01.md), which covers whitepaper v0.6, pre-graduation withdrawals, fees, and the expanded lifecycle stack.

- Review date: 2026-07-29
- Repository state reviewed: `47833b3287e2a5a314b384af15cf21c9b7dbd783` (`main`)
- Reviewer: Codex
- Primary specification: [PredictFun: A Two-Phase Prediction Market Launchpad, working draft rev. 0.4](documents/whitepaper_v4.pdf)
- Previous review: `predictfun_v4_review.md`, 2026-06-13
- Overall project/readiness score: 74/100

> This score is not directly comparable to the previous whitepaper's 88/100. That review scored a mechanism paper. This one scores the larger system now represented by the paper, ADRs, contracts, server, app, tests, and deployment state.

## Headline

Pop Charts is now a credible, unusually well-tested local end-to-end prototype, but it is not a production-ready market.

The strongest part remains the mechanism at the center of whitepaper v4: virtual-LMSR receipt issuance, path-based price-band eligibility, band-pass clearing, and the retained/refunded accounting identity. That design has moved well beyond prose. It now has Solidity and TypeScript implementations, deterministic off-chain clearing, on-chain settlement, full lifecycle tests, post-graduation outcome assets, a bounded trading venue, an indexer, a user application, and a bonded resolution/dispute flow.

The largest risk has changed. In June it was whether the mechanism was specified tightly enough to implement. In July it is whether the implemented system can safely and economically operate with real funds. Four items dominate:

1. the public application still serves sample data, while the deployment registry contains no deployed protocol;
2. the security audit program has tooling but no completed finding passes or external audit;
3. reliable post-graduation exits and the economics of supplying that liquidity remain unproven;
4. graduation clearing is manager-trusted and finalizes with a zero challenge period by default.

The project has also outgrown its paper. There is no updated whitepaper: v4 is still the canonical mechanism document, byte-for-byte identical to the copy previously reviewed. Much of the current system - cancellation economics, venue design, dispute resolution, AI review/resolution, operational trust boundaries, and the proposed mainnet custody architecture - exists only in ADRs and code. Several ADR progress lists have themselves fallen behind the code. The result is a working system without one current system specification.

## 1. Is there an updated whitepaper?

No.

The repository contains versions 0.1, 3, and 4. The latest is still the 19-page v4 draft created on 2026-06-12 and committed on 2026-06-13. It is explicitly designated the mechanism source of truth by [protocol ADR 0002](protocol/docs/adr/0002-treat-whitepaper-v4-as-mechanism-source.md). The two repository copies and the copy retained with the earlier review have the same SHA-256 hash:

```text
282e0f59108abbf4300b8d79133f4b8191cbc3d99259d0112ae5d0fc49b429c9
```

There is no v5, and the paper still uses the former PredictFun name throughout. This is not merely a branding lag. The paper predates material decisions now embedded in the project.

### What changed outside the paper

| Earlier review issue | Current project status | Paper status |
| --- | --- | --- |
| Resolution was removed without a pointer | A bonded optimistic proposal/dispute/finalization lifecycle is implemented across contracts, indexer, server, and app | Still absent |
| `CANCEL` economics were undefined | Pre-graduation cancellation refunds receipt cost; post-graduation cancellation/draw pays each outcome at 0.5 | Still undefined |
| Rounding was underspecified | Largest-remainder allocation is implemented and tested | Still an open question |
| Clearing complexity was operationally vague | A deterministic off-chain keeper, golden example, randomized tests, Merkle commitments, and fail-closed checks exist | Still high-level |
| “Anyone may freeze” was ambiguous | Only a configured graduation manager can start graduation, submit the root, and finalize | Still says anyone may freeze |
| Receipt transferability was open | Non-transferable receipts are the explicit v1 decision in [protocol ADR 0003](protocol/docs/adr/0003-keep-v1-receipts-locked-and-non-transferable.md) | Still open |
| Literature positioning had regressed | The repository has useful research notes, but the whitepaper bibliography is unchanged | Still regressed |

The cleanest next document is a v5 mechanism paper plus a short system architecture companion. The mechanism paper should stay mathematical and stable. The companion should own the changing operational design: trust roles, clearing submission, post-graduation venue, resolution, value-transfer receipts, deployment, and failure recovery.

## 2. Current project status by layer

| Layer | What exists now | Readiness judgment |
| --- | --- | --- |
| Pre-graduation market | Public creation guardrails, review state, virtual-LMSR receipts, escrow, path intervals, non-transferable receipt book, cancellation/refunds | Substantive implementation |
| Graduation clearing | Deterministic band-pass clearing, partial fills, largest-remainder rounding, Merkle root/totals, keeper discovery and settlement, randomized and lifecycle tests | Strong local implementation; trusted operator boundary |
| Post-graduation assets | Per-market complete-set market with fully collateralized YES/NO assets, mint/merge, resolution, cancellation, and redemption | Implemented for the current local/testnet architecture |
| Trading venue | Two bounded pools, one for each outcome against collateral, with managed orders and a local seeding path | Locally exercised; liquidity economics and terminal unwinding are not production-proven |
| Mainnet asset architecture | Proposed singleton position book plus two ERC-20 wrapper clones per market | Design only; all six phases in [protocol ADR 0012](protocol/docs/adr/0012-use-a-singleton-postgrad-position-book.md) remain open |
| Resolution | Bonded proposal, 24-hour dispute window, permissionless finalization when undisputed, operator settlement when disputed, API/app lifecycle | Broad implementation landed; governance and incentives remain centralized/under-designed |
| AI review and resolution | Evaluation datasets, regression policy, runners, and terminal-verdict corroboration | Meaningful quality infrastructure; still an operational model dependency |
| User application | Market browsing/detail/trading surfaces, portfolio states, dispute panel, terminal claims/redemption | Useful local path; production app currently exposes sample data |
| Indexer/API | Event-sourced lifecycle and value records, portfolio projections, keeper/admin paths, dispute data | Functional locally; reorg, confirmation, failover, leasing, lag, pagination, and rate-limit work remains |
| Deployment | Public frontend responds; local lifecycle works | `protocol.json` lists no local or testnet contract addresses; no deployed backend/protocol stack was evidenced |
| Security | Slither integration, audit catalogue, test directory, launch-cap thinking | Audit program is proposed; findings index is empty; no external audit |

The most important distinction is between local completeness and production completeness. The project has enough components to demonstrate the product honestly end to end. It does not yet have the deployment, adversarial review, decentralized trust boundaries, or demonstrated liquidity needed to make the same claim about real funds.

## 3. What is genuinely strong

### 3.1 The paper's core mechanism survived implementation

The strongest validation is not another algebra pass; it is that the mechanism was implementable without changing its basic accounting.

The project now computes the band-pass fixed point off chain, commits the result through a Merkle root and aggregate totals, and rechecks conservation at the contract boundary. The clearing implementation includes:

- the paper's worked example as a golden case;
- randomized books rather than only hand-selected examples;
- exact partial-fill and largest-remainder handling;
- snapshot binding and aggregate retained/refund checks;
- fail-closed behavior when the book or computed result is inconsistent.

The central accounting identity - escrow becomes retained collateral plus refunds - also continues into explicit event-sourced records. This is a particularly good architectural choice: the system does not ask a later indexer to infer money movement from current balances.

### 3.2 The project tests journeys, not only functions

The repository has lifecycle coverage for creation, review, trading, graduation, partial clearing, refund claims, post-graduation claims, resolution, cancellation/draw behavior, disputes, finalization, and redemption. This is a much stronger signal than a directory full of isolated unit tests.

The current `main` branch's app, server, protocol, infrastructure, and observability checks were green when reviewed. That does not establish economic or security correctness, but it substantially reduces integration uncertainty.

### 3.3 Cancellation and terminal value are now explicit

The earlier paper review correctly called `CANCEL` underspecified. The code has since made two coherent decisions:

- before graduation, a cancelled market returns the cost recorded by each receipt (the separate creation fee is not part of that refund);
- after graduation, cancellation behaves like a draw, making each YES or NO unit redeemable for 0.5 collateral.

The application also exposes terminal positions and redemption rather than leaving settlement as a contract-only feature. This closes a surprisingly common gap between protocol design and an actual user exit.

### 3.4 Resolution is now a real subsystem

The paper deliberately excluded resolution. The project no longer does. [Protocol ADR 0013](protocol/docs/adr/0013-bonded-optimistic-resolution-with-dispute-window.md) defines a proposal, bond, public dispute window, undisputed permissionless finalization, and disputed operator settlement. The implementation carries those states through the indexer, API, app, and lifecycle tests.

This is a considerable improvement over either immediate operator finality or an AI answer written directly on chain. It creates time for public objection and a paper trail for every transition.

It is not decentralized adjudication. A disputed outcome still ends at an operator/resolver decision, the flat bond and absence of a challenger reward have not been economically justified, and self-dispute is intentionally free. Those may be acceptable launch constraints, but they should be presented as trust assumptions rather than as solved mechanism design.

## 4. The post-graduation exit question

### 4.1 Full backing does not guarantee an early exit

A fully backed binary market guarantees terminal redemption, assuming the contracts remain solvent and the resolution process completes. It does not guarantee that a holder can sell before resolution at a reasonable price.

Those are different guarantees:

```text
solvency guarantee:
    a valid terminal claim can be paid

liquidity guarantee:
    a holder can exchange now, in size, with bounded slippage
```

The current post-graduation venue has separate YES/collateral and NO/collateral pools. A trader can exit only to the extent that the relevant pool or resting orders have collateral and are willing to take the other side. Complete-set arbitrage can encourage `YES price + NO price ≈ 1`, but it does not manufacture depth. During a one-sided rush to exit, the pool can become very expensive to trade against even while the outcome assets remain perfectly backed.

This is the most important answer to the research question: a fully backed LMSR-like system can offer reliable terminal redemption, but reliable early exit still requires separately funded market-making risk.

### 4.2 A conventional LMSR cannot be added “for free”

For a binary market, a conventional LMSR market maker's bounded worst-case loss is proportional to:

```text
b ln(2)
```

That bounded loss is useful, but somebody must fund it. Outcome-token collateral that is already reserved to redeem winning claims cannot simultaneously serve as loss capital for a market maker without weakening the redemption guarantee.

There are three honest implementations:

1. a sponsor funds an LMSR subsidy;
2. liquidity suppliers fund finite inventory/capital and accept its risk;
3. a different cost function makes liquidity scale with collected funds, with different pricing and incentive properties.

The saved Chen–Pennock and liquidity-sensitive market-maker literature is directly relevant here. It explains how worst-case loss and liquidity relate, and why removing a fixed subsidy requires changing the mechanism rather than renaming LP capital.

### 4.3 “Neutral” pre-graduation liquidity is a new mechanism

Allowing a user to supply liquidity before graduation without choosing YES or NO sounds like depositing equal value on both sides. Economically, however, that user still takes several risks:

- inventory becomes unbalanced as other traders select outcomes;
- the graduation clearing rule determines what inventory and collateral carry forward;
- the post-graduation venue may expose the position to adverse selection and divergence loss;
- cancellation, non-graduation, and terminal unwinding determine capital duration and operational cost.

This therefore cannot safely be bolted onto receipt issuance as a UI option. It needs a specified claim on fees, a withdrawal rule, clearing treatment, loss allocation, and terminal accounting. It is a separate risk-bearing instrument.

### 4.4 Why would a rational LP participate?

The project does not yet contain enough evidence to answer this.

An LP's expected return is approximately:

```text
fees + incentives
- adverse selection
- inventory/divergence loss
- gas and rebalancing cost
- capital opportunity cost
- smart-contract and resolution risk
```

The current testnet cap policy limits the possible loss surface, but a cap is not an incentive model. The documentation does not estimate trading volume, fee income, toxic flow, outcome-tail loss, capital duration, or the subsidy needed to make expected LP return competitive.

The right next step is not to assert that fees will compensate LPs. It is to simulate the two-pool venue and a funded post-graduation LMSR under the same market paths and flow assumptions:

- balanced noise flow;
- informed flow before resolution;
- a sudden probability jump;
- one-sided exit demand;
- low-volume long-duration markets;
- cancellation and disputed resolution.

For each design, measure exit slippage by trade size, sponsor/LP loss, fee income, capital utilization, price coherence, and terminal unwind success. That comparison would turn the current venue choice from a plausible implementation into an economic decision.

## 5. Highest-priority risks

### P0  -  before real user funds

#### 1. Complete the security program and obtain external review

[ADR 0023](docs/adr/0023-protocol-security-audit-program.md) reports an initial static-analysis baseline of 2 High, 16 Medium, roughly 21 Low, and roughly 8 Informational results. Those counts are not confirmed vulnerabilities, but they are untriaged work. The [findings index](protocol/docs/security/audit/README.md) is empty.

At minimum, the project needs:

- a mapped value-transfer and privilege surface;
- triage notes for every high/medium static-analysis result;
- invariants for escrow conservation, clearing totals, complete-set solvency, terminal redemption, and cross-market accounting;
- adversarial tests for clearing roots and manager compromise;
- a documented key, pause, cap, and incident model;
- an external audit before uncapped or meaningful mainnet funds.

The proposed singleton post-graduation book increases the importance of this work because it concentrates collateral across markets.

#### 2. Prove the production post-graduation architecture

The current per-market complete-set design is implemented. The proposed mainnet singleton book is not. Its ADR correctly identifies unresolved user-funds issues, including outcome decimals/dust and the complete terminal path:

```text
withdraw/cancel venue position → unwrap → redeem
```

That path must work for pool liquidity, open orders, wallet-held wrappers, and unclaimed graduation positions in both resolved and cancelled markets. Until then, “fully backed” describes the intended accounting, not a production- proven exit.

#### 3. Replace or bound trusted graduation-root finality

The clearing algorithm is deterministic and well tested, but the on-chain contract accepts roots only from a graduation manager. The configured challenge period defaults to zero because there is no third-party proposal or dispute mechanism.

This is reasonable for local development. For real funds, the project must choose one of:

- an actually challengeable root with an on-chain or reproducible verifier;
- independent redundant keepers with a bounded acceptance rule;
- a deliberately trusted operator with low caps, strong key controls, monitoring, pause/recovery procedures, and an explicit user-facing trust statement.

Calling the root “optimistic” without a viable challenger would overstate the guarantee.

#### 4. Deploy and rehearse the actual stack

The public frontend being reachable is not evidence of a deployed market system. The checked-in [deployment registry](protocol/deployments/protocol.json) contains empty contract maps for both local and testnet entries, and the frontend identifies its current content as sample data.

A launch candidate needs a reproducible environment with recorded contract addresses and code hashes, backend/indexer deployment, funded test wallets, monitoring, reorg/confirmation policy, RPC failure behavior, and an operator runbook. The existing lifecycle suite is the right seed for that rehearsal.

### P1  -  mechanism and operational closure

#### 5. Calibrate `b`, graduation threshold, and manipulation gates

These remain open questions from v4. The implementation currently accepts market parameters under public guardrails; the local path commonly uses `b = 5,000` and a graduation threshold of `2,500`. Those are development defaults, not evidence-based product settings.

The parameters jointly determine:

- receipt price responsiveness;
- capital required to graduate;
- how easily a small coalition can shape the eligible set;
- expected retained versus refunded capital;
- post-graduation depth available to seed the venue.

They should be selected from simulation and then validated with a capped testnet cohort. Anti-manipulation gates should be tied to an attack model, not only round numbers.

#### 6. Resolve post-graduation liquidity economics

Before adding general LP participation, specify who bears inventory risk, who earns which fees, how positions enter graduation clearing, and how capital exits every terminal state. Use the comparative simulation described above to choose between the current venue, a subsidized LMSR, or another funded market-maker design.

#### 7. Harden resolution incentives and governance

The dispute lifecycle is implemented, but its economics are provisional. Model false proposals, nuisance disputes, self-disputes, ambiguous outcomes, long-lived disputed markets, and operator unavailability. Decide whether the flat bond, forfeiture destination, no-bounty policy, and single-dispute limit produce the intended behavior at realistic market sizes.

#### 8. Harden the indexer and API

Event-sourced accounting is the correct foundation. Production still requires documented confirmation depth, reorg replay, RPC failover, worker leasing, cursor-lag alerts, idempotent recovery, rate limits, and pagination/search. These are part of money correctness because the application uses projections to tell users what they own and can claim.

### P2  -  product completion

- connect the post-graduation chart work to real indexed venue data;
- verify real sign-in, account, and profile journeys;
- finish review-first market drafting if it remains the intended creation UX;
- reconcile the public product language with actual deployment and trust guarantees.

## 6. Whitepaper open questions, updated

| Whitepaper question | Current answer |
| --- | --- |
| How should `b` be calibrated? | Still open. Development defaults and guardrails exist; no empirical calibration was found. |
| What should the graduation threshold be? | Still open. It is implemented and enforced, but not economically justified. |
| What rounding policy should be used? | Closed in implementation: largest-remainder allocation with deterministic tie behavior. |
| What anti-manipulation gates are required? | Partially implemented as public-creation bounds and lifecycle gates; no complete attack-derived policy. |
| Should receipts be transferable? | Closed for v1: no. Receipts are deliberately non-transferable. |

Additional questions introduced by the implementation are now at least as important:

- Who may submit and challenge a graduation root?
- Who funds reliable post-graduation liquidity, and on what return model?
- What is the production post-graduation custody/token architecture?
- How are wrapper dust, pool positions, open orders, and unclaimed positions unwound at resolution or cancellation?
- Who has final authority over disputed resolution, pause, and recovery?
- What deployment caps make those trust assumptions tolerable?

## 7. Literature positioning

The previous review's literature criticism still stands. The v4 bibliography does not adequately situate the design among the results most relevant to its claims.

The next paper should at least distinguish:

- Hanson, LMSR: the source of the cost function and bounded-loss market maker;
- Chen and Pennock: the relationship between liquidity, scoring rules, and worst-case loss;
- Othman, Pennock, Reeves, and Sandholm: liquidity-sensitive automated market making and why a no-fixed-subsidy design changes the cost function;
- Agrawal et al.: dynamic pari-mutuel mechanisms, correctly labeled rather than described as the source of LMSR;
- Budish, Cramton, and Shim: frequent batch auctions and the market-design rationale for discrete clearing;
- conditional-token and optimistic-oracle systems: prior art for post-graduation claims and resolution, with precise separation between what is reused and what is original here.

The project's interesting contribution is not “LMSR plus an AMM.” It is the combination of:

1. virtual path-dependent receipt pricing before commitment;
2. interval eligibility derived from the path a trade traversed;
3. maximum balanced band-pass clearing at graduation;
4. explicit retained/refunded accounting into fully backed outcome claims.

That claim is stronger when it is narrow and well cited.

### Primary literature used for this review

- Robin Hanson, [_Logarithmic Market Scoring Rules for Modular Combinatorial Information Aggregation_](https://mason.gmu.edu/~rhanson/mktscore.pdf)
- Yiling Chen and David M. Pennock, [_A Utility Framework for Bounded-Loss Market Makers_](https://arxiv.org/abs/1206.5252)
- Abraham Othman, David M. Pennock, Daniel M. Reeves, and Tuomas Sandholm, [_A Practical Liquidity-Sensitive Automated Market Maker_](https://dl.acm.org/doi/10.1145/1807342.1807384)
- Shipra Agrawal et al., [_A Unified Framework for Dynamic Pari-Mutuel Information Market Design_](https://arxiv.org/abs/0902.2429)
- Eric Budish, Peter Cramton, and John Shim, [_The High-Frequency Trading Arms Race: Frequent Batch Auctions as a Market Design Response_](https://academic.oup.com/qje/article/130/4/1547/1916146)

## 8. Scorecard

| Category | Weight | Score | Assessment |
| --- | --: | --: | --- |
| Mechanism soundness | 20% | 92 | The v4 mathematical core remains coherent and survived implementation |
| Implementation fidelity | 15% | 86 | Strong pregrad/clearing fidelity; material operational deviations are mostly documented |
| Lifecycle completeness | 15% | 82 | Broad local journey through resolution/redemption; production architecture still proposed |
| Economic completeness | 15% | 55 | Postgrad liquidity, LP incentives, calibration, and dispute economics are unresolved |
| Security and trust model | 15% | 58 | Good awareness and tooling; empty audit trail, centralized boundaries, no external audit |
| Product/deployment readiness | 10% | 48 | Real UI and local system, but public sample data and no evidenced protocol/backend deployment |
| Testing and observability | 10% | 86 | Strong cross-layer tests and green CI; production failure modes remain |
| Weighted total | 100% | 74 | Credible local system; not ready for material public funds |

## 9. Recommended sequence

1. Publish a current specification. Write v5 for the mechanism changes and a versioned architecture companion for trust roles, venue, resolution, and value flows. Reconcile ADR statuses with landed code.
2. Close the security gate. Triage current static-analysis results, build the value/privilege map, land conservation invariants, and commission an external review of the architecture intended to hold real funds.
3. Prove post-graduation exits. Complete the chosen mainnet asset architecture and exercise every pool/order/wrapper/unclaimed-position path through resolution and cancellation.
4. Run the liquidity study. Compare the present two-pool venue with a separately funded LMSR under common flows; quantify slippage, loss, fees, and subsidy requirements.
5. Rehearse a capped deployment. Deploy the full protocol, server, indexer, app, monitoring, and operator procedures together; record addresses, configuration, hashes, recovery behavior, and user-visible limitations.

## Bottom line

The project is substantially more real than the unchanged whitepaper suggests. Its distinctive pre-graduation mechanism has been translated into a coherent implementation, and the team has built much of the difficult connective tissue - clearing, event accounting, lifecycle state, disputes, claims, and redemption - that papers often leave implicit.

The remaining work is not cosmetic. A backed claim is not the same as a liquid exit; a deterministic clearing algorithm is not the same as a trustless root; a green local lifecycle is not the same as a deployed, audited money system. Those are now the project's decisive questions.

The correct near-term posture is therefore: mechanism validated enough to continue; architecture promising enough to harden; deployment not yet ready for material public capital.
