---
type: entity
title: Arc Testnet
description: The target public network — chain 5042002, dual-decimal native/ERC20 USDC, CREATE2/Multicall3/Permit2 present, no official Uniswap v4 (self-deployed).
sources:
  - protocol/docs/complete-set-v4-hook-order-manager-plan.md
  - protocol/docs/postgrad-contract-metadata.md
  - protocol/docs/adr/0009-complete-set-testnet-policy.md
  - protocol/deployments/README.md
updated: 2026-07-07
---

# Arc Testnet

Chain ID **5042002**, RPC `rpc.testnet.arc.network`, explorer on Blockscout.

## Load-bearing quirks

- **Native gas is USDC**, with a dual-decimal duality: 18-decimal native vs
  6-decimal ERC20 USDC at `0x36000...0000`. Always use the ERC20 interface
  for pool/token math. [Protocol ADR 0009](../summaries/protocol-adr-0009-complete-set-testnet-policy.md)'s
  open question 1 is whether `MARKET_CREATION_FEE = 1e18` native units has
  the intended real value given these semantics.
- CREATE2 deployer, Multicall3, Permit2 present; **no official Uniswap v4**,
  so the [postgrad v4 venue](postgrad-v4-venue.md) stack is self-deployed.
- Collateral policy: MockCollateral first; the real Arc ERC20 USDC only after
  dedicated smoke tests.

## Testnet policy (proposed, [protocol ADR 0009](../summaries/protocol-adr-0009-complete-set-testnet-policy.md))

Caps: 500/pool seed, 10k/market matched cap, 50k total, ≤20 markets. Single
deployer EOA holds all roles; public creation paused until a trusted-creator
full lifecycle completes on-chain. Audit-before-mainnet hard gates; multisig +
timelock migration before mainnet; nothing carries over from testnet.

Deployment is the final step of milestone M5
([root ADR 0015](../summaries/root-adr-0015-deployment-and-infrastructure.md));
`protocol/deployments/protocol.json` currently has no Arc entries.

## Related pages

- [Deployment and infrastructure](../concepts/deployment-and-infrastructure.md)
