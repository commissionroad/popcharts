<!-- Copy this file to <NN>-<slug>.md for each ADR 0023 catalogue item. NN = zero-padded catalogue index. Fill every field. Delete this comment. -->

# Audit finding <NN>: <catalogue item name>

- **Catalogue section:** <A: Trail of Bits skill | B: EVM-attack root-cause class | C: peer-audit category>
- **Source:** <e.g. ToB `token-integration-analyzer` | "Nomad — uninitialized trusted root" | "Uniswap v4 audit — hook callback safety">
- **Date:** <YYYY-MM-DD>
- **Severity:** <Critical | High | Medium | Low | Informational | Not applicable>
- **Status:** <Open | Fixed in <PR> | Acknowledged | Not vulnerable>
- **Auditor pass:** <who/what ran this pass>

## Threat, in this protocol

<One or two sentences: what this check is, and what a failure would concretely
look like _here_ — which funds move, which invariant breaks, who can trigger it.
Not the generic definition.>

## Surfaces examined

- `protocol/contracts/<file>.sol:<lines>` — <function(s) and why they are in scope>
- ...

## What I did

<The concrete steps: which functions were traced, what input was pushed through
by hand, which detector/test was run. Tag provenance: observed / read /
inferred / assumed.>

- Slither: `<command>` → <result / triage>
- Foundry PoC: `protocol/test/solidity/security/<NN>_<slug>.t.sol` → <red/green + what it proves>
- Invariant / fuzz: <if run>

## Finding

<The conclusion. If vulnerable: the exact exploit path, preconditions, and
impact, with the failing test as evidence. If not vulnerable: the specific guard
that prevents it (file:line) and the test that pins it so a regression is
caught. "Not applicable" is valid — say why the item cannot reach any surface.>

## Remediation

<For Open findings: the proposed fix and where it lands. For Critical/High:
note the follow-up PR / issue. The audit pass records; fixes land separately.
For "not vulnerable": any defense-in-depth hardening worth doing, or "none".>

## Evidence

- <links to committed PoC test, Slither output snippet, ADR/whitepaper cite>
