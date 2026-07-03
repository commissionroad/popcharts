import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// The v4 venue-stack contracts live in the pinned v4 packages, so Ignition
// must reference them by fully-qualified artifact name. The matching artifacts
// are emitted through `solidity.npmFilesToBuild` in hardhat.config.ts.
const POOL_MANAGER_ARTIFACT = "@uniswap/v4-periphery/lib/v4-core/src/PoolManager.sol:PoolManager";
const STATE_VIEW_ARTIFACT = "@uniswap/v4-periphery/src/lens/StateView.sol:StateView";
const QUOTER_ARTIFACT = "@uniswap/v4-periphery/src/lens/V4Quoter.sol:V4Quoter";

const VenueStackModule = buildModule("VenueStack", (m) => {
  const initialOwner = m.getAccount(0);

  const poolManager = m.contract(POOL_MANAGER_ARTIFACT, [initialOwner]);
  const stateView = m.contract(STATE_VIEW_ARTIFACT, [poolManager]);
  const quoter = m.contract(QUOTER_ARTIFACT, [poolManager]);
  const swapRouter = m.contract("MinimalV4SwapRouter", [poolManager]);

  return { poolManager, quoter, stateView, swapRouter };
});

export default VenueStackModule;
