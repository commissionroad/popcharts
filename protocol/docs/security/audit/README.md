# Protocol Security Audit — findings

This directory holds the finding notes produced by the security audit program
([ADR 0023](../../../../docs/adr/0023-protocol-security-audit-program.md)). The
program walks a fixed catalogue of checks — Trail of Bits _building-secure-contracts_
skills, root-cause classes from the twenty largest EVM exploits, and issue
categories that professional AMM / prediction-market audits look for — over the
Solidity protocol under `protocol/contracts/`, one item per pass.

Each catalogue item produces exactly one note here, **whether or not** it found a
vulnerability. A note that concludes "not vulnerable — here is the guard and the
test that pins it" is a first-class result. The procedure for one pass lives in
the `engineering/protocol-security-audit` skill.

`TEMPLATE.md` is the per-finding template. PoC and invariant tests live under
`protocol/test/solidity/security/`.

## Findings index

| #                                                           | Item | Section | Severity | Status | Note |
| ----------------------------------------------------------- | ---- | ------- | -------- | ------ | ---- |
| _(populated by the audit loop, one row per catalogue item)_ |      |         |          |        |      |

## Severity legend

Critical / High / Medium / Low / Informational / Not applicable — see the skill's
severity rubric. Anything Critical or High carries a committed Foundry PoC.
