# ADR 0023: Protocol Security Audit Program

Status: Proposed

Date: 2026-07-21

## Context

The Solidity protocol under `protocol/contracts/` is ~5,250 lines across 22
files and holds and moves value: `PregradManager.sol` (singleton, pregraduation
collateral custody, public-create envelope, graduation trigger),
`v4/BoundedPoolOrderManager.sol` (bounded CLOB-on-v4 with flash-accounting
settlement), `postgrad/CompleteSetBinaryMarket.sol` and
`postgrad/CompleteSetPostgradAdapter.sol` (complete-set mint/burn, redemption,
cancellation), `ReceiptBook.sol` / `CreationFeeVault.sol` /
`postgrad/OutcomeToken.sol` (custody and non-transferable receipts), plus the
LMSR / clearing / partial-fill math libraries.

Two facts make an unstructured "read the contracts once" review insufficient:

- **Value is about to scale.** ADR 0015 tracks the Arc Testnet deployment, and
  the launchpad-scale mandate plus the hybrid-mainnet path (protocol ADR 0012)
  point at real funds on mainnet at 100s–1000s of markets/day. The blast radius
  of a bug grows with every step on that path.
- **There is no security paper trail today.** No Slither, Echidna, or Medusa
  config is committed; there is no findings directory; nothing records *what was
  checked and why it is safe*. An external audit — which we will eventually
  want — starts by asking for exactly that trail, and its absence makes the
  engagement slower and more expensive.

An external audit is the eventual goal, not a substitute for doing the work
ourselves first. We can front-load audit-readiness by driving the same lenses
professional auditors use — Trail of Bits' published *building-secure-contracts*
skills — plus the concrete code-level root causes behind the twenty largest EVM
losses, plus the specific issue categories that AMM and prediction-market audits
have historically surfaced, over our own code. That produces the paper trail,
finds the cheap bugs before they are expensive, and tells us where an external
firm's time is best spent.

## Decision

Stand up a **tracked, one-item-per-pass security audit program** over the
Solidity protocol.

Fix a catalogue of checks in three sections:

- **Section A — Trail of Bits skills.** The Solidity/EVM-relevant skills from the
  Trail of Bits Claude Code skills marketplace
  ([`github.com/trailofbits/skills`](https://github.com/trailofbits/skills), a
  40-plugin marketplace; the EVM-relevant plugins are built on
  [`crytic/building-secure-contracts`](https://github.com/crytic/building-secure-contracts)).
  Each is a lens or tool-runner we apply to our protocol.
- **Section B — EVM-attack root-cause classes.** The recurring *code-level* root
  causes distilled from the twenty largest Ethereum/EVM-chain exploits of
  2020–2026. Each is a "confirm we are not vulnerable to this class, and here is
  why" check, anchored to the exemplar hack.
- **Section C — Peer-audit issue categories.** The issue categories that
  published audits of comparable protocols (Uniswap v2/v3/**v4 hooks**,
  conditional-token / prediction-market frameworks, AMMs) systematically check.

Each catalogue item is audited against `protocol/contracts/` by the
`engineering/protocol-security-audit` skill, which threat-models the item, reads
the real code, tries to break it (Slither detector, Foundry PoC, or invariant
fuzz), classifies severity, and writes one committed **finding note** under
`protocol/docs/security/audit/` — **whether or not** it found a vulnerability. A
loop (see "Running the loop") drives the catalogue to completion, one item per
iteration.

Principles:

1. **One item, one note, one commit.** Depth per item is the point; a pass that
   clears five items has skimmed five. The commit-per-item trail is bisectable.
2. **Negative results are results.** "Not vulnerable — here is the guard at
   `file:line` and the test that fails if it regresses" is a first-class,
   recorded outcome. So is "not applicable, because …".
3. **Critical/High needs a failing test.** A claimed exploit without a committed
   Foundry PoC is a hypothesis, not a finding.
4. **Record, don't fix, in the pass.** The audit records; fixes land as their
   own reviewed PRs. Money-handling fixes stay under human/Claude review per
   repo policy even when a tool or Codex drafted them.
5. **Follow the source's own ordering.** Map the attack surface (entry points)
   → build line-by-line context → hunt → verify each candidate (false-positive
   check) → hunt variants of anything confirmed.

## Progress

### Phase 0 — stand up tooling

- [x] **Slither runs against the protocol.** `protocol/scripts/security/slither.sh`
      (clean build → `slither-prepare.mjs` reshapes Hardhat 3 build-info →
      `slither-run.py` drives Slither's API, scoped to `project/contracts`).
      Needs a modern Slither in isolation (`uv tool install slither-analyzer`;
      the Homebrew 0.9.x is too old for file-level `using-for`). `slither.config.json`
      committed. Baseline run: **2 High, 16 Medium, ~21 Low, ~8 Info** in-scope —
      these feed A2. See `protocol/scripts/security/README.md` for the Hardhat-3
      incompatibilities the two helpers work around.
- [x] **Security test path wired.** `protocol/test/solidity/security/` exists with
      a green placeholder (`SecurityInvariants.t.sol`) discovered by
      `hardhat test solidity`; A10 replaces it with real invariant harnesses.
- [x] **Fuzzer status recorded.** Echidna and Medusa are **not** installed here;
      invariants (A10) run as Foundry invariant tests under `test/solidity/security/`,
      and `slither-mutate` (installed with slither-analyzer) covers mutation
      testing (A11). Installing Echidna/Medusa is optional future hardening.
- [ ] Optionally install the Trail of Bits skills marketplace
      (`/plugin marketplace add trailofbits/skills`) so section-A skills can be
      invoked directly rather than reimplemented. (Deferred — the loop
      reimplements each skill's procedure; requires an interactive session.)

### Section A — Trail of Bits building-secure-contracts skills

Recommended order (the marketplace's own): A1 → A9 → A10/A2 → hunt → A13 → A14.

- [ ] **A1. Attack-surface map** (`entry-point-analyzer`) — enumerate every
      externally callable state-changing function; classify Public / Role-
      restricted / Contract-only; produce the surface table the rest of the
      audit indexes against.
- [ ] **A2. Secure-development workflow** (`secure-workflow-guide`) — run
      Slither's full detector set and triage; run the special checks
      (`slither-check-upgradeability`, `slither-check-erc`, `slither-prop`);
      generate inheritance / function-summary / authorization diagrams.
- [ ] **A3. Token integration** (`token-integration-analyzer`) — ERC-20/721
      conformity and the ~24 weird-token patterns (missing return values,
      fee-on-transfer, rebasing, ERC777 receive hooks, non-standard decimals,
      approval-race) against every external token the protocol touches
      (collateral, outcome tokens, fee token).
- [ ] **A4. Code maturity** (`code-maturity-assessor`) — 9-category scorecard:
      arithmetic, auditing, access controls, complexity, decentralization,
      documentation, MEV, low-level code, testing.
- [ ] **A5. Guidelines / architecture** (`guidelines-advisor`) — on/off-chain
      split, upgradeability & proxy storage layout, delegatecall, inheritance /
      shadowing, event coverage, common pitfalls, dependency review.
- [ ] **A6. Audit-prep package** (`audit-prep-assistant`) — review goals /
      worst-case scenarios, static-analysis-clean baseline, coverage lift, dead-
      code removal, scoping doc — assembles the package an external firm ingests.
- [ ] **A7. Dimensional analysis** (`dimensional-analysis`) — annotate units,
      dimensions, and decimal scaling across all arithmetic; catch dimensional
      mismatches and precision bugs in `LmsrMath`, `ClearingMath`,
      `ReceiptBands`, `PartialFillMath`, `V4DeltaSettlement`.
- [ ] **A8. Spec-to-code compliance** (`spec-to-code-compliance`) — verify the
      contracts implement the whitepaper (protocol ADR 0002) and the protocol
      ADRs *exactly*; flag undocumented code paths and unimplemented spec claims.
- [ ] **A9. Audit context building** (`audit-context-building`) — line-by-line
      per-function micro-analysis of the high-value contracts; treat every
      external call as adversarial; record invariants explicitly.
- [ ] **A10. Property-based testing** (`property-based-testing`) — Echidna/Medusa
      (or Foundry invariant) properties for the core invariants: complete-set
      conservation, no value creation across mint/burn/redeem, LMSR monotonicity,
      price-band enforcement, receipt-band accounting.
- [ ] **A11. Mutation testing** (`mutation-testing` / `genotoxic` →
      `slither-mutate`) — surface untested logic; surviving mutants in
      value-transfer code are coverage gaps to close.
- [ ] **A12. Differential review** (`differential-review`) — security-focused
      diff review with blast-radius and adversarial modeling; adopt as the gate
      for future protocol PRs (HIGH-risk = auth, external calls, value transfer,
      validation removal).
- [ ] **A13. False-positive verification** (`fp-check`) — verify each suspected
      finding to a TRUE/FALSE-POSITIVE verdict with full source-to-sink data-flow
      tracing before it is called a finding; check whether rejected findings chain.
- [ ] **A14. Variant analysis** (`variant-analysis`) — after any confirmed
      finding, hunt every similar instance across the codebase (ripgrep →
      Semgrep → CodeQL as needed).
- [ ] **A15. Semgrep static analysis** (`semgrep` + `sarif-parsing`) — run the
      Decurity / Trail of Bits / 0xdea Solidity rulesets and aggregate SARIF
      alongside Slither output.
- [ ] **A16. Sharp edges & insecure defaults** (`sharp-edges` +
      `insecure-defaults`) — footgun APIs on the periphery/SDK, and fail-open
      defaults at the off-chain trust boundary (keeper, operator panel, indexer).
- [ ] **A17. Supply-chain risk** (`supply-chain-risk-auditor`) — audit npm and
      Solidity dependencies (v4 core/periphery, forge-std, OZ) for takeover /
      unmaintained / known-CVE risk.

_(Excluded as not EVM-relevant: the Algorand/Cairo/Cosmos/Solana/Substrate/TON
scanners, the C/Rust/Python/crypto-RE plugins, and the native-fuzzing
testing-handbook skills. See the audit skill for the full exclusion list.)_

### Section B — EVM-attack root-cause classes (top-20 exploits, 2020–2026)

Each item: confirm the protocol is not vulnerable to this class, with a note and
(for any live exposure) a PoC. Exemplars are the hacks the class comes from.

Two cross-cutting principles from the exploit set frame every item below:

- **Assume unlimited atomic capital.** Flash loans were the *amplifier*, not the
  root cause, in most code-level exploits (Beanstalk, Cream, BonqDAO, Balancer,
  Curve, Rari/Fei, KyberSwap). Every economic invariant must hold within a
  single transaction; "an attacker could never afford that position" is not a
  defense.
- **Distrust the default.** Two of the worst code bugs came from a zero/empty
  value being read as "valid/proven" (Nomad's `0x00` root; BNB's unconstrained
  proof node). Audit every place a default, zero, or uninitialized value could
  pass a check.

- [ ] **B1. Reentrancy** (cross-function, read-only, ERC777-hook) — state
      written *after* an external call. Exemplars: The DAO; Cream (callback);
      ERC777 receive hooks. Focus: settlement callbacks in
      `BoundedPoolOrderManager` / `V4DeltaSettlement`, redemption paths.
- [ ] **B2. Missing / incorrect access control** on privileged functions —
      unprotected mint, keeper-role reassignment, owner-only actions. Exemplars:
      Poly Network (keeper role reassigned), Gala (dormant minter). Focus:
      graduation trigger, admin cancel, complete-set mint, operator entrypoints.
- [ ] **B3. Bad / missing initialization of trusted state** — a trusted root or
      config left at a permissive default. Exemplar: Nomad (trusted Merkle root
      initialized to `0x00`, making every message "proven"). Focus: the
      off-chain clearing Merkle root, any proxy init, hook/pool config.
- [ ] **B4. Signature / Merkle-proof / message-verification flaw** — a forged
      proof or spoofed signature accepted as valid. Exemplars: BNB Chain (forged
      IAVL proof), Wormhole (spoofed guardian signature). Focus: the optimistic
      off-chain graduation clearing proof and any signature-gated claim/redeem.
- [ ] **B5. Price / oracle manipulation via flash loan** — spot pool state used
      as a price/valuation oracle. Exemplars: Cream (vault-share manipulation),
      BonqDAO (oracle). Focus: any value derived from live pool balances, LMSR
      price bounds, collateral valuation.
- [ ] **B6. Flash-loan governance / economic takeover** — a decision that depends
      on manipulable within-transaction state. Exemplar: Beanstalk
      (`emergencyCommit` via flash-borrowed votes). Focus: any protocol action
      gated on instantaneously acquirable balances or single-tx state.
- [ ] **B7. Arithmetic precision / rounding / invariant drift** — integer
      division at boundaries distorts the invariant or lets value leak.
      Exemplars: Balancer V2 (stable-pool wei-rounding), Compound (distribution
      bug). Focus: `LmsrMath` exp/ln, `ClearingMath`, `PartialFillMath`,
      `ReceiptBands` rounding direction and dust handling.
- [ ] **B8. Business-logic / missing health-check invariant break** — a function
      mutates accounting without re-checking the core solvency invariant.
      Exemplar: Euler (`donateToReserves` skipped the health check → self-
      liquidation). Focus: every state-mutating path that should re-assert
      collateralization / conservation — including "credit/mint only against
      value actually received" (Qubit minted bridge tokens from a deposit event
      that never verified ETH arrived): confirm complete-set mint and collateral
      credit happen only after the transfer-in is realized.
- [ ] **B9. Off-chain trust-boundary compromise** (keys, multisig-UI deception,
      infra/DVN) — the dominant loss category, not a Solidity bug but a design
      question. Exemplars: Bybit, Ronin, WazirX, KelpDAO, Multichain, Harmony.
      Focus: what the contracts *trust* off-chain (operator keys, graduation
      trigger, clearing root, keeper) and the on-chain guardrails that bound the
      blast radius if that trust is violated (pause, bounds, challenge window,
      value caps).
- [ ] **B10. Bridge / cross-chain message verification** — cross-chain trust and
      proof verification. Exemplars: Poly, BNB, Nomad, Harmony, Multichain.
      Focus: the hybrid-mainnet path (protocol ADR 0012) and any cross-chain
      assumption baked into settlement or custody.
- [ ] **B11. Supply-chain / front-end injection** — malicious dependency or
      signing-surface UI. Exemplars: Bybit (Safe UI), BadgerDAO (front-end).
      Focus: build/dependency integrity and the operator admin/signing surface
      (overlaps A16/A17).
- [ ] **B12. Classic Solidity footgun catalogue** (Trail of Bits
      *not-so-smart-contracts*) — sweep the ten historical Solidity classes as a
      confirm-or-dismiss baseline: denial of service (unbounded loops / gas),
      forced ether reception, incorrect interface, integer overflow (largely
      neutralized by 0.8 checked math — confirm no `unchecked` blocks reintroduce
      it), race condition / front-running, reentrancy (cross-refs B1), unchecked
      external-call return values, unprotected function (cross-refs B2), variable
      shadowing, and wrong constructor name (pre-0.4.22 — expect not-applicable).

### Section C — Peer-protocol audit categories (AMM / prediction market)

Distilled from published audits of directly comparable protocols (see "Reference
audits" below). Fit tags: 🔴 critical-fit, 🟠 strong-fit, 🟡 applicable. Two
invariants dominate this corpus and are the keystones for our stack — both
should be machine-checked (A10) before anything else: **(i) escrow/pool solvency**
— outstanding shares plus pending Merkle claims are always ≤ collateral held
(ToB v4 "the singleton can always cover its debts"), and **(ii) complete-set
conservation / sum-to-one** across split, merge, LMSR trade, and redeem (Gnosis
CTF).

- [ ] **C1. Fixed-point / rounding / precision math** 🔴 — every `exp`/`ln`/
      `mulDiv` in `LmsrMath` / `ClearingMath` has a documented, consistent
      rounding direction that favors the pool; the approximation error of the
      transcendental functions is bounded and proven not to break invariants;
      threshold comparisons don't exceed 100% at boundaries; accumulators can't
      underflow. Sources: Spearbit v4 5.2.1–5.2.3 (mixed rounding, inaccurate
      constants/error bounds), ToB v4 TOB-UNI4-1/-2/-4 (fee comparison/bitmask),
      ToB "FeeGrowthGlobal cannot underflow", ABDK v3/v4 precision style.
- [ ] **C2. Flash accounting / settlement deltas** 🔴 — every currency delta nets
      to zero before the locked section returns (unsettled dust reverts → DoS);
      side-effect operations (fee collection, keeper actions) inside a locked
      section don't corrupt in-flight deltas; delta sign/magnitude conventions
      are exhaustively unit-tested. Sources: ToB v4 TOB-UNI4-3 (protocol fees
      counted against user delta), Certora v4 I-01 (flash accounting unsafe
      around untrusted calls), Cyfrin hook deep-dive. Surface:
      `V4DeltaSettlement`, `BoundedPoolOrderManager`.
- [ ] **C3. Hook / callback safety** 🔴 — every callback asserts
      `msg.sender == poolManager`; the hook permission bitmap matches the
      implemented callbacks exactly; `PoolKey`/hook address is validated at init;
      hook return-data length/encoding is exact and guarded against returndata
      bombing; the trust model for hooks is documented (first-party only vs.
      untrusted). Sources: Cork Protocol $12M (`unlockCallback` access control),
      Bunni V2 $8.4M (reentrancy-lock bypass), OZ v4 trust model, Spearbit v4
      5.2.5. Surface: `BoundedPredictionHook`, `MinimalV4SwapRouter`.
- [ ] **C4. Complete-set / conditional-token invariants** 🔴 — mint/burn
      conservation (outcome shares always fully collateral-backed; split and
      merge conserve value exactly); **burn-before-mint** ordering to block
      reentrancy-based ID forgery; collision-resistant condition/position-ID
      derivation (no additive hashing); redemption pays exactly the resolved
      numerator and zero for losers, never before resolution or twice. Sources:
      Gnosis CTF audit (Issue 1 burn-before-mint, Issue 2 AdHash→ECMH),
      Polymarket NegRiskAdapter `WrappedCollateral` conservation. Surface:
      `CompleteSetBinaryMarket`, `CompleteSetPostgradAdapter`, `OutcomeToken`.
- [ ] **C5. Merkle proof / claim verification (off-chain clearing)** 🔴 — a
      `claimed` mapping blocks double-claims (a valid proof alone must not permit
      repeat); leaf hashing is domain-separated from internal-node hashing
      (second-preimage / 64-byte-node replay); root-set authorization and mid-
      distribution root-swap safety; the on-chain guard enforces total payout ≤
      escrowed collateral so a buggy/malicious off-chain root cannot over-
      distribute. Sources: Zokyo/Cyfrin Merkle-airdrop findings, ToB v4 solvency
      invariant. Surface: the optimistic off-chain graduation clearing (protocol
      ADR 0006).
- [ ] **C6. Access control, privileged roles, initialization** 🟠 — every
      state-mutating admin/keeper function has an explicit authorization check;
      first-deposit / pool-init front-running can't drain seed liquidity;
      privileged setters validate inputs; lifecycle actions (graduation, draw-at-
      half, refund, cancel) can't run out of order or unauthorized. Sources:
      Augur C03 (public function deletes all dispute crowdsourcers), OZ v4 M-03
      (init front-running), UMA input validation, Polymarket NegRiskAdapter
      (permissioned-but-still-approval-checked transfer, the good pattern).
- [ ] **C7. Reentrancy (token receive hooks)** 🟠 — CEI ordering plus guards on
      split/merge/redeem/claim; ERC-1155/6909/777 receive hooks and native-value
      transfers treated as re-entrant; the unlock guard itself is non-bypassable
      across nested unlock calls. Sources: Gnosis CTF forgery, Augur H04-H05/C05
      (ERC-777 hooks), Bunni V2 lock bypass. (Cross-refs B1.)
- [ ] **C8. ERC-20 / token edge cases** 🟠 — collateral trust model written down
      (whitelist vs. handle fee-on-transfer / rebasing / non-standard returns);
      no native-vs-ERC20 double-representation double-count; low-level transfer
      success is always checked (`SafeTransferLib`). Sources: OZ v4 **C-01
      Critical** (CELO double-entry-point drain), ToB v3 TOB-UNI-009 (failed-
      transfer check). Surface: collateral custody in `PregradManager`,
      `CreationFeeVault`. (Cross-refs A3, B12.)
- [ ] **C9. Oracle / price manipulation / resolution & dispute** 🟠 — any price /
      `totalSupply` / balance read used for clearing or resolution is
      manipulation-resistant (TWAP/EMA/checkpoint, not spot); optimistic-
      resolution bond sizing and challenge-window timing can't be griefed or
      frozen; resolution status is canonical and monotonic (no double-resolve, no
      pre-finalization payout, draws explicit). Sources: Curve crvUSD
      (`totalSupply` flash-manip → EMA fix), UMA OO audits, Augur C07 (dispute
      bonds frozen in forks). (Cross-refs B5.)
- [ ] **C10. DoS / gas griefing** 🟡 — permissioned controllers can't be gas-
      griefed; liquidity-slot exhaustion can't block adds; returndata bombing and
      unsettled-delta reverts can't halt trading; poison orders can't freeze a
      market. Sources: OZ v4 M-02, Certora v4 L-02, Spearbit v4 5.2.5, Augur C05.
- [ ] **C11. Front-running / MEV** 🟡 — JIT liquidity can't steal donations/fees;
      init/first-deposit front-running mitigated. Sources: Spearbit v4 5.1.1
      (JIT donation theft), OZ v4 M-03. (Cross-refs C6.)
- [ ] **C12. Signatures / EIP-712 / replay** 🟡 — *if any off-chain-signed order
      or claim path exists or is added:* signatures bind to signer identity
      (reject any-address / zero-address signer); correct `ORDER_TYPEHASH` and
      non-fork-cached domain separator; every economically-material field
      (esp. fees) is inside the signed hash; nonce/replay protection. Source:
      Polymarket CTF Exchange audit (multiple Criticals, incl. fee rate not
      hashed).
- [ ] **C13. Observability, events, code maturity** 🟡 — every critical state
      transition emits a complete, indexed event (our indexer + SSE change-feed
      *depend* on this — operational, not cosmetic); pinned pragma, correct
      `memory-safe` assembly annotations, no unsafe casts/ABI encoding; the
      invariant-test harness (C-keystones) exists and runs in CI. Sources: ToB v4
      TOB-UNI4-5, Certora v4 M-01, UMA event-indexing notes. (Cross-refs A4, A10,
      A11; ties to ADR 0021 change-feed.)

#### Reference audits

- Uniswap v4 core — Trail of Bits, OpenZeppelin, Certora, Spearbit/Cantina, ABDK
  (`github.com/Uniswap/v4-core/tree/main/docs/security/audits`).
- Uniswap v3 core — Trail of Bits (2021-03-12, 2 High incl. swap-callback balance
  check), ABDK (`github.com/Uniswap/v3-core/tree/main/audits`).
- Gnosis Conditional Tokens Framework audit
  (`github.com/gnosis/conditional-tokens-contracts`).
- Polymarket — ChainSecurity: CTF Exchange (2022-12), Conditional Tokens (2024-04),
  NegRiskAdapter (2024-04), UMA Sports Oracle (2025-06).
- Augur Core v2 — OpenZeppelin (2020-02, 8 Criticals).
- UMA Optimistic Asserter / Oracle — OpenZeppelin.
- Curve crvUSD / StableSwap — ChainSecurity; Balancer V2 — Trail of Bits + Certora.
- Merkle-claim finding class — Zokyo / Cyfrin CodeHawks writeups.

Gap: no published third-party audit of an on-chain **LMSR** implementation was
found; C1's LMSR precision guidance is extrapolated from the v4 tick-math
precision findings (the closest analogue). If LMSR-specific precedent is needed,
the next step is the Gnosis `pm-contracts` / `lmsr` and Zeitgeist/Omen audit
history.

## Running the loop

The catalogue is walked one item per pass by the
`engineering/protocol-security-audit` skill. The `/audit-next` command
(`.claude/commands/audit-next.md`) is the thin entry point: it runs that skill
against the first unchecked `- [ ]` box (Phase 0 → A → B → C, in order), or a
specific id you pass (`/audit-next B7`). To drive the whole catalogue to
completion, one item per pass, run it under the loop:

```
/loop /audit-next
```

Each pass opens this ADR, audits one item, writes the finding note, ticks the
box, and commits; the loop stops when every box is checked. (Equivalently,
`/audit-next` on its own does a single item.)

Findings accumulate in `protocol/docs/security/audit/` (indexed by its
`README.md`); PoC and invariant tests in `protocol/test/solidity/security/`.
Fixes for anything the loop surfaces land as separate reviewed PRs.

## Deferred / out of scope

- **Fixes.** This program *finds and records*; remediation PRs are tracked
  separately as findings land.
- **The off-chain half** (server, indexer, keeper, AI review/resolution, app) is
  audited here only where a contract trusts it (B9). A full off-chain security
  program is a separate effort.
- **External third-party audit.** This program makes us audit-ready and is not a
  replacement for an eventual external engagement; A6 assembles that package.
