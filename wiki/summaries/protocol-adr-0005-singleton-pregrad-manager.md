---
type: summary
title: "ADR 0005: Use A Singleton Pregrad Manager"
description: Accepted — one singleton manager owns all pregrad market state keyed by marketId, receipts are internal ledger records, and the factory-per-market scaffold is transitional
sources:
  - protocol/docs/adr/0005-use-a-singleton-pregrad-manager.md
updated: 2026-07-07
---

# ADR 0005: Use A Singleton Pregrad Manager

**Status: Accepted.**

## Decision

Use a singleton pre-graduation manager as the target architecture for Pop
Charts v1. The manager owns pregrad state for **all** markets, keyed by
`marketId`. Receipts are internal ledger records keyed by `receiptId` — not
standalone receipt contracts and not transferable ERC1155 tokens. See
[pregrad manager](../entities/pregrad-manager.md).

The originally scaffolded `PopChartsFactory` / `PregradMarket`
(factory-per-market) contracts are declared transitional: useful for initial
Hardhat smoke tests, to be replaced before real receipt, LMSR, or graduation
logic lands.

## Context

All Pop Charts pre-graduation markets share the same mechanics — virtual
LMSR state, locked non-transferable receipts, collateral escrow,
manager-started graduation/refund lifecycle, and deterministic receipt
accounting. They are many instances of one receipt-and-escrow state machine,
not independent AMMs with bespoke reserves.

Precedent cited from current DeFi patterns: Polymarket/Gnosis CTF's shared
ERC1155 outcome-token infrastructure keyed by condition/position IDs, Uniswap
v4's singleton `PoolManager`, Balancer's Vault separation of custody and
accounting, and Aave's central `Pool` entry point.

## Consequences

- Market creation is cheaper than deploying a contract per market; portfolio
  and receipt reads target one canonical pregrad contract (which serves the
  receipt-centric UI and any indexing over it).
- Shared lifecycle checks and escrow accounting live in one place (see
  [market lifecycle](../concepts/market-lifecycle.md)).
- The singleton needs careful storage layout, explicit market isolation, and
  strong tests proving one market cannot corrupt another's receipts, escrow,
  lifecycle, or clearing state
  ([testing strategy](../concepts/testing-strategy.md)).
- Libraries still keep math and clearing helpers modular — singleton does not
  mean one large unreadable contract.
- Bespoke pregrad behavior for a future market should come through a small
  policy/module boundary, not by reviving per-market deployments.

## Related pages

- [Summary: protocol README](protocol-readme.md) — confirms
  `contracts/PregradManager.sol` is now the entry point
- [Summary: ADR 0003 — locked receipts](protocol-adr-0003-v1-receipts-locked-non-transferable.md)
- [Summary: ADR 0006 — optimistic offchain clearing](protocol-adr-0006-optimistic-offchain-graduation-clearing.md)
