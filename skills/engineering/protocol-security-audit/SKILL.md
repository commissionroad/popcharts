---
name: protocol-security-audit
description: Use when auditing the Pop Charts Solidity protocol under protocol/contracts against one catalogued security check — a Trail of Bits building-secure-contracts item, a historical EVM-attack root-cause class, or a peer-protocol audit category. Drives one checklist item from ADR 0023 end to end: threat-model it, read the real code, try to break it (Slither / Foundry PoC / invariant), classify severity, and record a finding note. This is the unit of work the audit loop repeats.
---

# Protocol Security Audit (one item per pass)

## Overview

This skill audits the deployed-value surface of the Pop Charts protocol —
`protocol/contracts/` — against **one** item from the catalogue in
[ADR 0023](../../../docs/adr/0023-protocol-security-audit-program.md). The
catalogue has three sections: Trail of Bits *building-secure-contracts* checks
(section A), root-cause classes distilled from the twenty largest EVM exploits
(section B), and issue categories that professional AMM / prediction-market
audits look for (section C).

One pass = one catalogue item = one committed finding note. The audit loop
(see the ADR's "Running the loop" section) calls this skill repeatedly until
every box is ticked. **Do not batch items.** Depth per item is the point; a
pass that "quickly clears" five items has skimmed all five.

A finding note is produced **whether or not** the protocol is vulnerable. "Not
exploitable, and here is the specific guard that prevents it, and here is the
test that would fail if that guard regressed" is a first-class result — it is
the paper trail an external auditor will want.

## Scope

In scope — every Solidity file under `protocol/contracts/` (exclude
`protocol/contracts/mocks/`). The value-bearing, highest-risk surfaces, in
rough order:

- `PregradManager.sol` — singleton, holds pregraduation collateral, runs the
  public-create envelope and the graduation trigger.
- `v4/BoundedPoolOrderManager.sol` — the bounded CLOB-on-v4 order manager and
  its flash-accounting settlement.
- `postgrad/CompleteSetBinaryMarket.sol` and `postgrad/CompleteSetPostgradAdapter.sol`
  — complete-set mint/burn, redemption, and cancellation.
- `ReceiptBook.sol`, `CreationFeeVault.sol`, `postgrad/OutcomeToken.sol` — value
  custody and non-transferable receipt accounting.
- `v4/BoundedPredictionHook.sol`, `v4/MinimalV4SwapRouter.sol`,
  `v4/libraries/V4DeltaSettlement.sol` — hook callbacks, unlock/settlement
  deltas, price-bound enforcement.
- Libraries: `libraries/LmsrMath.sol`, `libraries/ClearingMath.sol`,
  `libraries/ReceiptBands.sol`, `v4/libraries/PartialFillMath.sol`,
  `v4/libraries/OrderValidation.sol`, `v4/libraries/OrderBook.sol`,
  `v4/libraries/DeferredExecutionStore.sol`, `v4/libraries/PackedOrderId.sol`,
  `v4/PoolTickBounds.sol`, `types/MarketTypes.sol`.

Out of scope for this program (note if relevant, but do not audit here): the
TypeScript server/indexer/keeper, off-chain AI review/resolution, and the app.
Off-chain components enter only where a contract *trusts* them (e.g. the
graduation trigger, the Merkle clearing root, operator-only entrypoints).

## Workflow for one item

1. **Select the item.** Open ADR 0023, find the first unchecked `- [ ]` box in
   sections A → B → C (in order). That checklist line, plus its catalogue
   entry, is your item. If every box is ticked, stop: the audit is complete.

2. **State the threat.** In one or two sentences, write what the item *is* and
   what going wrong would look like *in this protocol specifically* — not the
   generic definition. "Reentrancy" is not a threat statement; "a maker whose
   settlement callback re-enters `fillOrder` before `filledAmount` is written
   could be filled twice against one deposit" is.

3. **Map to surfaces.** List the exact contracts and functions where this
   threat could live. Use the scope list above and `grep`/read to find the real
   call sites. If the item cannot apply to any surface (e.g. an ERC-4626 check
   on a protocol with no vault), say so and record a short "not applicable"
   note — that is still a pass.

4. **Read the real code.** Open those functions and re-derive the behaviour by
   tracing a concrete input through them. Do not conclude from a function's
   name or a comment. Check the boring, high-risk spots first: external-call
   ordering vs. state writes, access-control modifiers, unchecked math and
   casts, rounding direction, unit/decimals boundaries, initialization, and
   every place the contract trusts an off-chain caller or an ERC-20's return.

5. **Try to break it.** Attempt to construct a concrete exploit path or an
   invariant violation. Escalate the evidence to match the risk:
   - **Slither** for the mechanical detectors that map to the item. Run
     `protocol/scripts/security/slither.sh` (optionally `--json out.json`); it
     reshapes the Hardhat 3 build for Slither and reports findings scoped to
     `project/contracts`. Needs `uv tool install slither-analyzer` (0.11+; the
     Homebrew 0.9.x is too old). See `protocol/scripts/security/README.md`.
     Triage every hit as true/false positive with a reason.
   - **A Foundry PoC** when you believe there is a real exploit or want to
     prove a guard holds. Write it under `protocol/test/solidity/security/` as
     `<NN>_<slug>.t.sol` and run `pnpm --dir protocol test:solidity`
     (Hardhat 3's Solidity runner; `forge-std` is available). A red test that
     demonstrates the exploit is the strongest possible finding; a green test
     that pins the guard is the strongest possible "not vulnerable."
   - **An invariant / fuzz test** (Foundry invariant or Echidna/Medusa if
     installed) for accounting-conservation and math items — e.g. complete-set
     sum-to-one, no-value-creation across mint/burn/redeem, LMSR monotonicity.

6. **Classify severity.** Use impact × likelihood (see rubric). Record the
   reasoning, not just the label.

7. **Write the finding note.** Copy `protocol/docs/security/audit/TEMPLATE.md`
   to `protocol/docs/security/audit/<NN>-<slug>.md` (NN = zero-padded catalogue
   index) and fill every field. Keep any PoC test committed alongside so the
   result is reproducible.

8. **Record it.** Add a row to `protocol/docs/security/audit/README.md` (the
   findings index) and tick the ADR 0023 box, linking the note:
   `- [x] <item> — [<severity>](../../protocol/docs/security/audit/<NN>-<slug>.md)`.

9. **Commit** just this item's note, test, and the two checklist/index edits
   with a message like `audit(0023): <NN> <item> — <severity>`. One item per
   commit keeps the paper trail bisectable.

## Severity rubric

Impact × likelihood, resolved to a single label. When in doubt, rate up.

- **Critical** — direct, likely theft or permanent loss of user/protocol funds,
  or a break of the core solvency invariant, reachable by an unprivileged
  caller.
- **High** — fund loss or invariant break that needs a specific (but feasible)
  precondition, or a privileged-role escalation.
- **Medium** — value leak, griefing/DoS of a core flow, or a bound that can be
  violated without direct theft.
- **Low** — limited impact, hard preconditions, or defense-in-depth gaps.
- **Informational** — code-quality, missing checks with no current exploit,
  hardening suggestions, deviations from the whitepaper/ADR mechanism.

Anything Critical/High gets a Foundry PoC before it is called Critical/High —
a claimed exploit without a failing test is a hypothesis, not a finding.

## Conventions

- Follow `engineering/protocol-code-quality`: no third-party company/protocol
  product names in test names or notes' code; use mechanism vocabulary
  (`venue`, `completeSet`, `postgrad`, `boundedPool`, `receipt`, `clearing`).
- Ground every claim in provenance: *observed* (I ran the PoC / Slither and saw
  it), *read* (the code/ADR says it), *inferred*, *assumed*. Say the tag out
  loud in the note wherever the conclusion rests on something below "observed."
- Cite the code as `protocol/contracts/<file>.sol:<line>` so the note is
  clickable and survives refactors via the surrounding context.
- Do not fix in the same pass. A finding note may propose a remediation and,
  for Critical/High, open a follow-up; the audit pass records, it does not
  refactor. Fixes land as their own reviewed PRs.
