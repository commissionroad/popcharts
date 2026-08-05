---
type: summary
title: Repo ADR 0023 — Protocol security audit program (docs/adr/0023-protocol-security-audit-program.md)
description: PROPOSED program standing up a tracked, one-item-per-pass security audit over the ~5,250-line Solidity protocol — a fixed 42-item catalogue (Trail of Bits lenses, top-20 EVM exploit root causes, peer-audit categories) walked by a skill that writes one committed finding note per item whether or not it finds a bug. Phase 0 tooling is 3/4 done; no catalogue item has been audited yet.
sources:
  - docs/adr/0023-protocol-security-audit-program.md
  - protocol/docs/security/audit/README.md
  - protocol/docs/security/audit/TEMPLATE.md
updated: 2026-08-05
---

# Repo ADR 0023: Protocol Security Audit Program

**Status: Proposed.** Dated 2026-07-21. Not part of the M1–M5 launch chain; it
runs alongside as audit-readiness work over
[protocol/](../entities/protocol-workspace.md).

## Why

Two facts make an unstructured "read the contracts once" review insufficient:

- **Value is about to scale.** [ADR 0015](root-adr-0015-deployment-and-infrastructure.md)
  tracks the [Arc Testnet](../entities/arc-testnet.md) deployment, and the
  launchpad-scale mandate plus the hybrid-mainnet path
  ([protocol ADR 0012](protocol-adr-0012-singleton-postgrad-position-book.md))
  point at real funds at 100s–1000s of markets/day.
- **There was no security paper trail.** No Slither/Echidna/Medusa config, no
  findings directory, nothing recording *what was checked and why it is safe* —
  which is the first thing an external audit asks for.

The program is explicitly **not** a substitute for an eventual external
engagement; it front-loads the work an external firm would otherwise bill for,
and tells us where their time is best spent.

## The decision

A **tracked, one-item-per-pass audit** over a fixed catalogue in three sections:

- **Section A — Trail of Bits lenses (17 items).** The EVM-relevant skills from
  the `trailofbits/skills` marketplace, built on `crytic/building-secure-contracts`:
  attack-surface map, Slither workflow, token integration, code maturity,
  dimensional analysis, spec-to-code compliance, property-based testing,
  mutation testing, false-positive verification, variant analysis, Semgrep,
  supply-chain risk. Recommended order is the marketplace's own:
  A1 → A9 → A10/A2 → hunt → A13 → A14.
- **Section B — EVM-attack root causes (12 items).** The code-level root causes
  behind the twenty largest EVM exploits of 2020–2026, each anchored to its
  exemplar hack (reentrancy/The DAO, access control/Poly Network, bad
  initialization/Nomad, proof forgery/BNB + Wormhole, oracle manipulation/Cream,
  flash-loan governance/Beanstalk, rounding/Balancer V2, missing health check/Euler).
- **Section C — Peer-audit categories (13 items).** What published audits of
  comparable protocols (Uniswap v3/v4 hooks, Gnosis CTF, Polymarket, Augur, UMA,
  Curve, Balancer) systematically check, fit-tagged 🔴/🟠/🟡.

Two cross-cutting principles frame Section B: **assume unlimited atomic capital**
(flash loans were the amplifier, not the root cause — every economic invariant
must hold within one transaction), and **distrust the default** (Nomad's `0x00`
root and BNB's unconstrained proof node were both a zero value read as "valid").

Section C names the two keystone invariants for this stack, both to be
machine-checked before anything else: **escrow/pool solvency** (outstanding
shares plus pending Merkle claims ≤ collateral held) and
**[complete-set](../concepts/complete-sets.md) conservation / sum-to-one** across
split, merge, LMSR trade, and redeem.

## Operating principles

1. **One item, one note, one commit** — a pass that clears five items has
   skimmed five. The trail is bisectable.
2. **Negative results are results.** "Not vulnerable — here is the guard at
   `file:line` and the test that fails if it regresses" is a first-class
   recorded outcome, as is "not applicable, because …".
3. **Critical/High needs a failing test.** A claimed exploit without a committed
   Foundry PoC is a hypothesis, not a finding.
4. **Record, don't fix, in the pass.** Fixes land as their own reviewed PRs;
   money-handling fixes stay under human review even when a tool drafted them.
5. **Follow the source's own ordering** — map the attack surface → build
   line-by-line context → hunt → verify each candidate → hunt variants.

## Status (verified 2026-08-05)

**Phase 0 tooling is 3/4 ticked; the catalogue itself is untouched — 0 of 42
items audited, and the findings index is empty.**

| Block                          | State                                             |
| ------------------------------ | ------------------------------------------------- |
| Phase 0 — tooling              | 3/4 — Slither, security test path, fuzzer status  |
| Section A — ToB lenses         | 0/17                                              |
| Section B — EVM root causes    | 0/12                                              |
| Section C — peer categories    | 0/13                                              |

Landed and verified present in the repo:

- `protocol/scripts/security/slither.sh` plus `slither-prepare.mjs` /
  `slither-run.py`, which reshape Hardhat 3 build-info for Slither's API.
  Baseline in-scope run: **2 High, 16 Medium, ~21 Low, ~8 Info** — this feeds A2.
  Needs a modern Slither (`uv tool install slither-analyzer`); Homebrew's 0.9.x
  is too old for file-level `using-for`.
- `protocol/test/solidity/security/SecurityInvariants.t.sol` — a green
  placeholder that A10 replaces with real invariant harnesses.
- Echidna and Medusa are **not** installed; invariants run as Foundry invariant
  tests and `slither-mutate` covers mutation testing (A11). Installing them is
  optional future hardening.
- `protocol/docs/security/audit/` with `README.md` (findings index, currently
  empty) and `TEMPLATE.md`.

The one unticked Phase 0 box — installing the Trail of Bits skills marketplace —
is deliberately deferred; the loop reimplements each skill's procedure instead,
since installing requires an interactive session.

## Running it

`skills/engineering/protocol-security-audit/SKILL.md` is the procedure for one
pass; `.claude/commands/audit-next.md` is the thin entry point, which runs it
against the first unchecked box (Phase 0 → A → B → C) or a specific id
(`/audit-next B7`). `/loop /audit-next` drives the catalogue to completion.

## Known gap the ADR records

No published third-party audit of an on-chain **LMSR** implementation was found,
so C1's LMSR precision guidance is extrapolated from Uniswap v4 tick-math
precision findings. If LMSR-specific precedent is needed, the next step is the
Gnosis `pm-contracts` / `lmsr` and Zeitgeist/Omen audit history.

## Deferred / out of scope

- **Fixes** — this program finds and records; remediation is tracked separately.
- **The off-chain half** (server, indexer, keeper, AI review/resolution, app) is
  in scope only where a contract trusts it (B9). A full off-chain security
  program is a separate effort.
- **External third-party audit** — A6 assembles the package for it.

## Related pages

- [protocol/ workspace](../entities/protocol-workspace.md) — the audit target
- [Complete sets](../concepts/complete-sets.md) — C4's conservation invariants
- [Graduation clearing](../concepts/graduation-clearing.md) — C5's Merkle claim surface
- [Postgrad v4 venue](../entities/postgrad-v4-venue.md) — C2/C3 hook and settlement surface
- [Testing strategy](../concepts/testing-strategy.md) — where invariant/PoC tests live
