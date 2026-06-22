import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const ArcProtocolModule = buildModule("ArcProtocol", (m) => {
  const collateral = m.contract("MockCollateral");
  const feeCollateral = m.contract("MockFeeCollateral");
  const pregradManager = m.contract("PregradManager");

  return { collateral, feeCollateral, pregradManager };
});

export default ArcProtocolModule;
