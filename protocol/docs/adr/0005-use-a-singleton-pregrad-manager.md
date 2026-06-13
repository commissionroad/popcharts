# ADR 0005: Use A Singleton Pregrad Manager

## Status

Accepted

## Context

The first scaffold introduced `PopChartsFactory` and `PregradMarket` as a clean
starting point: one factory deploys one pre-graduation market contract per
market. That shape is easy to read, but it is not obviously the best protocol
architecture for a long-tail launchpad.

Pop Charts pre-graduation markets all share the same mechanics:

- virtual LMSR state
- locked non-transferable receipts
- collateral escrow
- manager-started graduation / refund lifecycle
- deterministic receipt accounting

Those markets are not independent AMMs with bespoke reserves. They are many
instances of one receipt and escrow state machine.

The strongest current DeFi patterns point away from deploying a full contract
for every market when many markets share accounting logic:

- Polymarket and Gnosis CTF use shared ERC1155-style outcome-token
  infrastructure keyed by condition and position IDs.
- Uniswap v4 moved from per-pool contracts toward a singleton `PoolManager`
  keyed by pool IDs.
- Balancer separates shared token custody and accounting into a Vault while
  letting pool logic remain modular.
- Aave exposes a central `Pool` entry point with supporting registries and
  configurators.

## Decision

Use a singleton pre-graduation manager as the target architecture for Pop
Charts v1.

The manager will own the pregrad state for all markets, keyed by `marketId`.
Receipts will be internal ledger records keyed by `receiptId`, not standalone
receipt contracts and not transferable ERC1155 tokens.

The scaffolded factory-per-market contracts are transitional. They are useful
for initial Hardhat smoke tests, but should be replaced before real receipt,
LMSR, or graduation logic is implemented.

## Consequences

Market creation becomes cheaper than deploying a full contract per market.
Portfolio and receipt reads can be designed around one canonical pregrad
contract. Shared lifecycle checks and escrow accounting live in one place.

The singleton manager needs careful storage layout, explicit market isolation,
and strong tests proving one market cannot corrupt another market's receipts,
escrow, lifecycle, or clearing state.

Libraries should still keep math and clearing helpers modular. Singleton does
not mean one large unreadable contract.

If a future market needs bespoke pregrad behavior, it should be added through a
small policy/module boundary rather than by reviving per-market deployments by
default.
