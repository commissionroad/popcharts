---
description: Audit the next unchecked ADR 0023 security-catalogue item against the protocol
argument-hint: [catalogue-id e.g. A3 | empty = next unchecked]
---

Follow `skills/engineering/protocol-security-audit/SKILL.md` exactly — it is the
single source of truth for one audit pass; do not improvise a lighter version.

Catalogue: `docs/adr/0023-protocol-security-audit-program.md`.

Target: $ARGUMENTS — a catalogue id (e.g. `A3`, `B7`, `C1`). If empty, take the
first unchecked `- [ ]` box in order (Phase 0 → A → B → C).

Audit exactly **one** item: threat-model it, read the real `protocol/contracts`
code, try to break it (Slither via `protocol/scripts/security/slither.sh`, a
Foundry PoC, or an invariant), classify severity, write the finding note under
`protocol/docs/security/audit/`, tick the ADR box, and commit that one item. If
every box is already checked, stop and report that the audit is complete.

To walk the whole catalogue one item at a time, run this command under the loop:
`/loop /audit-next`.
