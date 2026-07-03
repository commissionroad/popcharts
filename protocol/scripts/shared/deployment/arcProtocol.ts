import type { IgnitionContractDescriptor } from "../ignition/buildContractDeployments.js";

/**
 * Shared identifiers for the Arc Testnet full protocol Ignition deployment.
 */
export const ARC_PROTOCOL_DEPLOYMENT = {
  contracts: [
    {
      contractName: "MockCollateral",
      futureId: "ArcProtocol#MockCollateral",
      manifestKey: "collateral",
      resultKey: "collateral",
    },
    {
      contractName: "MockFeeCollateral",
      futureId: "ArcProtocol#MockFeeCollateral",
      manifestKey: "feeCollateral",
      resultKey: "feeCollateral",
    },
    {
      contractName: "PregradManager",
      futureId: "ArcProtocol#PregradManager",
      manifestKey: "pregradManager",
      resultKey: "pregradManager",
    },
  ],
  defaultDeploymentFile: "deployments/arc-testnet.protocol.local.json",
  defaultDeploymentId: "arc-testnet-protocol",
} as const satisfies {
  contracts: readonly IgnitionContractDescriptor[];
  defaultDeploymentFile: string;
  defaultDeploymentId: string;
};
