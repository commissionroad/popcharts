---
type: concept
title: Mechanism whitepaper (v4)
description: whitepaper_v4.pdf is the mechanism source of truth — virtual LMSR + band-pass clearing; earlier drafts are context only, and several repo concepts trace to them, not v4.
sources:
  - documents/whitepaper_v4.pdf
  - documents/whitepaper_v3.pdf
  - documents/whitepaper_v0_1.pdf
  - protocol/docs/adr/0002-treat-whitepaper-v4-as-mechanism-source.md
  - protocol/CONSTITUTION.md
updated: 2026-07-07
---

# Mechanism whitepaper

`documents/whitepaper_v4.pdf` — "PredictFun: Bootstrapping Prediction Markets
With Virtual LMSR And Band-Pass Graduation Clearing", rev 0.4, June 2026,
WORKING DRAFT — is the **source of truth for protocol semantics**
([protocol ADR 0002](../summaries/protocol-adr-0002-whitepaper-v4-mechanism-source.md)).
Full mechanism digest: [whitepaper v4 summary](../summaries/whitepaper-v4.md);
draft evolution: [whitepaper history](../summaries/whitepaper-history.md).

## Core reframings v4 establishes

- **Virtual LMSR** (§3): `q_yes`/`q_no` are demand-pricing state, not sold
  inventory; `b` is virtual smoothness, not a funded loss budget; markets
  open at any prior via a pure state offset. Matched liquidity ≠
  volume/escrow/open interest.
- Receipts as path intervals with exact path-integral cost (§4); band-pass
  clearing with `E = R + L` conservation (§6) — see
  [graduation clearing](graduation-clearing.md).
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
- Fees: v4 charges none and requires any future fee to be explicit in the
  identity — see [creation-fee custody](creation-fee-custody.md).
- v4 supersedes aggregate share/collateral matching, price buckets, and
  receipt-average partial fills; §5 proves why (also
  [protocol ADR 0002](../summaries/protocol-adr-0002-whitepaper-v4-mechanism-source.md)).

All papers say "PredictFun"; the product is Pop Charts. Display equations in
the PDFs are images — text extraction misses them; the v4 summary
reconstructs each formula and verifies it against the worked-example numbers.
