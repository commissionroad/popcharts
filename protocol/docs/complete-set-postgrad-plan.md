# Complete-Set Postgrad Market Plan

Status: planning, researched on 2026-06-19.

## Executive Summary

We should treat a complete-set ERC20 venue as a testnet post-graduation pattern:
dedicated ERC20 YES and NO tokens, two Uniswap v4 pools per market
(`YES/collateral` and `NO/collateral`), complete-set mint/merge/redemption
semantics, and seeded testnet liquidity. The external reference protocol does
not use Gnosis CTF for its current YES/NO storage. It deploys per-market ERC20
`YesNoToken` contracts.

Arc Testnet does not currently appear to have official Uniswap v4 core/periphery
contracts deployed. Arc's docs list Permit2, CREATE2, and Multicall3, but not
PoolManager, PositionManager, StateView, Quoter, or Universal Router. The
official Uniswap v4 deployment matrix also does not list Arc Testnet. Direct
Arc RPC bytecode checks at the official/common Uniswap v4 deployment addresses
found code only at Permit2.

That means the practical testnet path is:

1. Deploy or provision the Uniswap v4 stack ourselves on Arc Testnet, or use an
   official v4 testnet such as Base Sepolia/Unichain Sepolia until Arc has
   official v4 deployments.
2. Add a Pop Charts postgrad adapter and ERC20 complete-set market contracts,
   not Gnosis CTF contracts, for the immediate complete-set testnet plan.
3. Capture the ERC20 testnet deviation in a new ADR, because ADR 0007 currently
   points to CTF-compatible ERC1155 outcome infrastructure as the preferred
   postgrad direction.

## Answers From Research

### Are the appropriate Uniswap v4 contracts already deployed on Arc Testnet?

No confirmed official deployment was found.

Arc Testnet official network details:

- Chain ID: `5042002`
- RPC: `https://rpc.testnet.arc.network`
- Explorer: `https://testnet.arcscan.app`
- Arc USDC ERC20 interface: `0x3600000000000000000000000000000000000000`
- Permit2: `0x000000000022D473030F116dDEE9F6B43aC78BA3`

Direct RPC check:

```txt
Arc RPC check on 2026-06-19:
chainId=5042002 block=47732549

CODE   9152 bytes Arc docs Permit2
empty     0 bytes Uniswap v4 Ethereum PoolManager
empty     0 bytes Uniswap v4 Unichain PoolManager
empty     0 bytes Uniswap v4 Base PoolManager
empty     0 bytes Uniswap v4 Sepolia PoolManager
empty     0 bytes Uniswap v4 Unichain Sepolia PoolManager
empty     0 bytes Uniswap v4 Base Sepolia PoolManager
empty     0 bytes Uniswap v4 Ethereum PositionManager
empty     0 bytes Uniswap v4 Sepolia PositionManager
empty     0 bytes Uniswap v4 Base Sepolia PositionManager
empty     0 bytes Uniswap v4 Ethereum Universal Router
empty     0 bytes Uniswap v4 Sepolia Universal Router
empty     0 bytes Uniswap v4 Base Sepolia Universal Router
empty     0 bytes Uniswap v4 Ethereum StateView
empty     0 bytes Uniswap v4 Sepolia StateView
empty     0 bytes Uniswap v4 Base Sepolia StateView
```

Planning implication: do not assume Arc Testnet has a usable Uniswap v4
`PoolManager`. Make v4 contract addresses explicit deployment inputs and fail
fast if they have no bytecode.

### How does the reference venue interact with Uniswap v4?

The reference docs say all YES/NO trading executes onchain through a custom
Uniswap v4 hook, and each market has two dedicated pools: `YES/TYD` and
`NO/TYD`.

The source code shows this shape:

- `TruthMarketV2` stores `yesToken`, `noToken`, `paymentToken`, `yesPoolKey`,
  `noPoolKey`, `yesPoolId`, `noPoolId`, and `hookAddress`.
- `YesNoToken` is a mintable ERC20 owned by the market, not an ERC1155 CTF
  position token.
- `mint(paymentTokenAmount)` transfers payment token into the market and mints
  equal YES and NO token amounts.
- `burn(amount)` burns equal YES and NO token amounts and returns payment token
  before finalization.
- `redeem(amount)` burns the winning token and returns payment token after the
  market finalizes.
- `TruthMarketHook` implements Uniswap v4 `beforeSwap` and `afterSwap`; after
  swaps it moves pool ticks through `OrderManager` and can collect hook fees.
- `TruthMarketSwapValidator` can enforce per-pool tick bounds after a swap.
- `OrderManager` tracks onchain limit-order-like liquidity positions and
  executes crossed orders as the pool tick moves.

Planning implication: for Pop Charts testnet, we can adopt the core market
object and pool layout without importing the reference protocol's full oracle,
order manager, or upgradeable contract stack. The smallest useful slice is
ERC20 outcome tokens, complete-set mint/merge/redeem, v4 pool initialization, a
price-bound hook, and seed-liquidity scripts.

### Does The Reference Protocol Use CTF To Store YES/NO Tokens?

No. The reference implementation's current public contracts use per-market ERC20
`YesNoToken` contracts. This differs from Polymarket/Gnosis CTF, where outcome
positions are ERC1155 token IDs minted by a shared Conditional Tokens contract.

Planning implication: do not add Gnosis CTF solely because of the reference
protocol. If we want to preserve ADR 0007's CTF compatibility, use one of these
explicit choices:

- Testnet-fast path: ERC20 complete-set market, documented as "CTF-style
  economics, not Gnosis CTF tokenization."
- Compatibility path: canonical or ported Conditional Tokens plus ERC20 wrappers
  for each YES/NO position so Uniswap v4 pools can trade ERC20s.

The testnet-fast path better matches the stated goal of kicking CLOB work down
the road and getting Arc Testnet pools trading immediately.

## Fit With Pop Charts

Pop Charts' whitepaper and protocol constitution require these invariants:

- no final outcome token before graduation
- matched receipt segments mint fully collateralized complete sets
- unmatched segments refund at exact recorded path cost
- `retainedCost + refund = receipt.cost`
- locked collateral equals maximum winner payout

The complete-set testnet layer should begin only after Pop Charts graduation
clearing. It must not reinterpret pre-graduation receipts as fills. The postgrad
adapter receives only finalized retained collateral and retained YES/NO claim
amounts.

Current `main` state:

- `PregradManager` supports market creation, receipt placement, graduation
  start, optimistic clearing-root submission, and refund marking.
- `MarketTypes.ReceiptClaim` already has `retainedShares`, `retainedCost`, and
  `refund` fields.
- The current mainline does not yet expose finalization, Merkle proof claims, or
  a real `IPostgradAdapter` contract. Those need to land before users can claim
  postgrad tokens.

## Recommended Architecture

### Contracts

Add these under `protocol/contracts/postgrad/`:

- `OutcomeToken.sol`
  - Minimal ERC20 for one market outcome.
  - Mint/burn restricted to the owning postgrad market contract.

- `CompleteSetBinaryMarket.sol`
  - Owns collateral escrow for one graduated market.
  - Deploys or references one YES token and one NO token.
  - `mintCompleteSets(address to, uint256 amount)` deposits collateral and
    mints equal YES and NO.
  - `mergeCompleteSets(uint256 amount)` burns equal YES and NO and returns
    collateral before resolution.
  - `resolve(Side winningSide)` marks the outcome in the testnet resolver path.
  - `redeem(uint256 amount)` burns winning tokens and pays collateral.
  - Optional cancel/draw path can redeem YES and NO at half value, but only if
    product requirements need it for testnet.

- `CompleteSetPostgradAdapter.sol`
  - Bridges `PregradManager` finalization/claims into the postgrad market.
  - Initializes the binary market when graduation finalizes.
  - Receives retained collateral from `PregradManager`.
  - Mints/distributes retained YES or NO tokens during receipt claims.
  - Emits explicit market/pool/token addresses for the server indexer.

- `BoundedPredictionMarketHook.sol`
  - Minimal Uniswap v4 hook for testnet pools.
  - Enforces per-outcome price bounds through ticks.
  - May start with `afterSwap` validation only.
  - Must be deployed with an address whose low-order bits encode the selected
    hook permissions.
  - Avoids the reference protocol's full order-manager machinery until we need onchain limit
    order execution.

Avoid importing external reference contracts directly:

- Their contracts are designed around Base, TYD, upgradeable mastercopies, and a
  custom oracle system.
- Their source spans Solidity `^0.8.0` and `^0.8.24`; Pop Charts is pinned to
  Solidity `0.8.28`.
- Their order manager is substantial and should not become implicit scope for
  the first testnet bridge.

Avoid adding canonical Gnosis CTF in the first slice:

- The public package is old Solidity `^0.5.1`/Truffle-era code.
- CTF positions are ERC1155 IDs, while Uniswap v4 pools need ERC20 currencies.
- We would still need ERC20 wrappers or a custom periphery to trade them in v4.

### Deployment And Scripts

Add explicit Arc Testnet deployment manifests:

- `protocol/deployments/arc-testnet.postgrad.json`
- `protocol/deployments/arc-testnet.uniswap-v4.json`

Add scripts:

- `scripts/check-arc-v4.mjs`
  - Checks configured `PoolManager`, `PositionManager`, `StateView`, `Quoter`,
    `UniversalRouter`, and `Permit2` addresses for bytecode.
  - Prints chain ID and block number.

- `scripts/deploy-arc-v4-stack.mjs`
  - Only if we choose self-deployed v4 on Arc Testnet.
  - Uses canonical Uniswap repos/artifacts or pinned local packages.
  - Writes deployment manifest.

- `scripts/deploy-postgrad-market.ts`
  - Deploys `CompleteSetBinaryMarket`, outcome tokens, and hook.
  - Mines or otherwise derives the hook deployment salt needed for Uniswap v4
    hook permission bits.
  - Initializes two pools and records pool IDs.

- `scripts/seed-postgrad-pools.ts`
  - Mints fake complete sets.
  - Adds liquidity to `YES/collateral` and `NO/collateral` v4 pools.
  - Requires explicit testnet-only flags.

Collateral choice:

- Fastest: use repo `MockCollateral` for all testnet postgrad seeding.
- More Arc-native: use Arc's USDC ERC20 interface at
  `0x3600000000000000000000000000000000000000`, but handle its 6-decimal ERC20
  interface and the separate 18-decimal native gas accounting carefully.

## Implementation Phases

### Phase 0: Decision ADR

Create a new ADR before code:

- Title: `Use Complete-Set ERC20 Postgrad Markets On Testnet`
- Decision: testnet postgrad markets use ERC20 YES/NO complete-set markets plus
  seeded Uniswap v4 pools.
- Explicit deviation from ADR 0007: "CTF-style economics" for now, not Gnosis
  CTF token IDs.
- Exit criterion: revisit CTF wrappers or CLOB before mainnet.

### Phase 1: Complete-Set Market

Implement and test the ERC20 complete-set market:

- complete-set mint conserves collateral
- merge burns equal YES/NO and returns collateral
- after resolution, only winning tokens redeem
- no payout can exceed locked collateral
- decimals are explicit and tested

### Phase 2: Pregrad Adapter

Finish the `PregradManager` settlement/claim surface and adapter boundary:

- finalization waits until challenge deadline
- claim leaves prove `retainedCost + refund == receipt.cost`
- retained collateral moves into postgrad market
- claim distributes retained YES/NO tokens and refunds unmatched escrow
- repeated claims revert

### Phase 3: Local Uni v4 Smoke

Bring up a local v4 stack or test harness:

- initialize YES/collateral and NO/collateral pools
- seed both pools at a starting probability
- execute one YES buy and one NO buy
- verify price bounds and complete-set arbitrage routes

### Phase 4: Arc Testnet

Run the Arc path:

- verify v4 addresses or deploy self-managed v4 stack
- deploy mock collateral or choose Arc USDC
- deploy postgrad contracts
- initialize and seed pools
- record all addresses in deployment manifests
- run one end-to-end graduated-market smoke: pregrad claim -> token balance ->
  pool trade -> resolution -> redeem

## Open Questions

1. Do we accept self-deployed Uniswap v4 contracts on Arc Testnet, or should
   Pop Charts use Base Sepolia/Unichain Sepolia until Arc has official v4?
2. For testnet pool liquidity, do we want repo `MockCollateral` or Arc USDC?
3. Should the first hook only enforce 0-to-1 price bounds, or should it also
   enforce cross-pool constraints such as `YES price + NO price <= 1`?
4. Do we need Complete-set cancel/draw redemption at 0.5 each, or only binary
   YES/NO resolution?
5. Is the testnet resolver a manager-only call, or should it integrate with the
   existing optimistic-resolution plan?
6. Should CTF compatibility mean "economic semantics" for testnet and "actual
   Gnosis-style ERC1155 plus ERC20 wrappers" for mainnet?

## Risks

- Independent YES and NO pools can drift away from a coherent binary market
  unless complete-set mint/merge arbitrage is available and cheap.
- Self-deployed v4 on Arc Testnet will not be an official Uniswap deployment and
  may not route through official frontends or APIs.
- A v4 hook deployment is not an ordinary contract deployment; the hook address
  itself encodes which callbacks PoolManager may call.
- Arc's native USDC model has 18-decimal gas accounting but a 6-decimal ERC20
  interface; contracts should use the ERC20 interface for token accounting.
- Copying the external reference protocol's hook/order-manager system would import a large amount of
  scope and audit surface.
- Adding old Gnosis CTF directly would introduce an incompatible Solidity and
  ERC1155 integration burden before we have the postgrad adapter working.

## Source Links

- Arc network setup: https://docs.arc.io/arc/references/connect-to-arc
- Arc contract addresses: https://docs.arc.io/arc/references/contract-addresses
- Arc x Uniswap announcement: https://community.arc.io/public/blogs/arc-x-uniswap-swap-and-liquidity-infrastructure-for-arc-2026-06-15
- Uniswap v4 deployments: https://developers.uniswap.org/docs/protocols/v4/deployments
- Uniswap v4 PoolManager: https://developers.uniswap.org/docs/protocols/v4/concepts/poolmanager
- Uniswap v4 hooks: https://developers.uniswap.org/docs/protocols/v4/concepts/hooks
- External reference protocol docs and contracts reviewed during 2026-06-19
  research. Keep external names out of implementation identifiers.
- Polymarket CTF overview: https://docs.polymarket.com/trading/ctf/overview
- Gnosis Conditional Tokens: https://github.com/gnosis/conditional-tokens-contracts
