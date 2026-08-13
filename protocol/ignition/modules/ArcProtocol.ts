import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const ArcProtocolModule = buildModule("ArcProtocol", (m) => {
  const collateral = m.contract("MockCollateral");
  const feeCollateral = m.contract("MockFeeCollateral");
  // The withdrawal state machine (ADR 0014 P3) is an external library because
  // the manager sits near the EIP-170 code-size limit; the manager links it.
  const receiptWithdrawals = m.library("ReceiptWithdrawals");
  const pregradManager = m.contract("PregradManager", [], {
    libraries: { ReceiptWithdrawals: receiptWithdrawals },
  });

  return { collateral, feeCollateral, pregradManager, receiptWithdrawals };
});

export default ArcProtocolModule;
