---
type: concept
title: Mechanism whitepaper (v0.6)
description: whitepaper/v0.6.md is the mechanism source of truth — virtual LMSR + band-pass clearing + lock-the-overlap withdrawals; the paper now lives in-repo as markdown, and several repo concepts trace to superseded drafts.
sources:
  - whitepaper/v0.6.md
  - whitepaper/v0.5.md
  - whitepaper/v0.4.md
  - documents/whitepaper_v4.pdf
  - documents/whitepaper_v3.pdf
  - documents/whitepaper_v0_1.pdf
  - protocol/docs/adr/0002-treat-whitepaper-v4-as-mechanism-source.md
  - protocol/CONSTITUTION.md
updated: 2026-08-04
---

# Mechanism whitepaper

[`whitepaper/v0.6.md`](../../whitepaper/v0.6.md) — "Pop Charts: A No-Subsidy
Use Of LMSR For Prediction Market Bootstrapping", rev 0.6, August 2026,
WORKING DRAFT — is the **source of truth for protocol semantics**
([protocol ADR 0002](../summaries/protocol-adr-0002-whitepaper-v4-mechanism-source.md)).

As of 2026-08 the paper lives in the repo as markdown with its own build
([`whitepaper/`](../../whitepaper/README.md)), so a mechanism change and the
code it governs can land in one diff. The PDFs in `documents/` are published
artifacts, not authority. Digests: [v0.6](../summaries/whitepaper-v6.md) for
what changed, [v4](../summaries/whitepaper-v4.md) for the full mechanism spec
(still accurate for everything v0.6 left alone); draft evolution:
[whitepaper history](../summaries/whitepaper-history.md).

## Core reframings v4 establishes

- **Virtual LMSR** (§3): `q_yes`/`q_no` are demand-pricing state, not sold
  inventory; `b` is virtual smoothness, not a funded loss budget; markets
  open at any prior via a pure state offset. Matched liquidity ≠
  volume/escrow/open interest.
- Receipts as path intervals with exact path-integral cost (§4); band-pass
  clearing with `E = R + L` conservation (§6) — see
  [graduation clearing](graduation-clearing.md).
- **v0.6 additions**: the lock-the-overlap withdrawal rule and its
  `F`-invariance lemma (§4, §6 Lemma 3), fees as an explicit `E = R + L + Φ`
  term, and fee-funded seeding of the post-graduation pools (§7). See
  [protocol ADR 0014](../summaries/protocol-adr-0014-pre-graduation-withdrawals-and-fees.md).
- Golden-test data: §9 Examples A and B. Open question 3 (§11): rounding
  policy for deterministic clearing under integer arithmetic — unresolved,
  lands on the [clearing keeper](../entities/clearing-keeper.md).

## What is NOT in v4 (provenance traps)

Repo vocabulary that traces to the superseded drafts, not the source of truth:

- "Pregrad/postgrad" wording, the rich state names, `pregrad_*` deadline
  fields, creator bonds, and the market review/approval stage — v3 (which is
  internally labeled **rev 0.2**; only v4's filename matches its rev label).
- The resolution pipeline and market-rule JSON schema — v0.1/v3; see
  [AI-assisted resolution](ai-assisted-resolution.md).
- Fees: v4 charged none and required any future fee to be explicit in the
  identity. v0.6 §7 takes that option up — entry and withdrawal fees held
  outside escrow as `E = R + L + Φ` — so "the mechanism charges no fees" is now
  a statement about v4, not about the current paper. See
  [creation-fee custody](creation-fee-custody.md).
- v4 supersedes aggregate share/collateral matching, price buckets, and
  receipt-average partial fills; §5 proves why (also
  [protocol ADR 0002](../summaries/protocol-adr-0002-whitepaper-v4-mechanism-source.md)).

Revisions through v0.5 say "PredictFun"; v0.6 renames the paper to Pop Charts
to match the product. Display equations in the PDFs are images — text
extraction misses them, and the v4 summary reconstructs each formula and
verifies it against the worked-example numbers. From v0.6 on this trap is gone:
the markdown source carries the equations as LaTeX and the build renders them
to SVG.
