export declare const ARC_PROTOCOL_DEPLOYMENT: {
  readonly contracts: readonly [
    {
      readonly contractName: "MockCollateral";
      readonly futureId: "ArcProtocol#MockCollateral";
      readonly manifestKey: "collateral";
      readonly resultKey: "collateral";
    },
    {
      readonly contractName: "MockFeeCollateral";
      readonly futureId: "ArcProtocol#MockFeeCollateral";
      readonly manifestKey: "feeCollateral";
      readonly resultKey: "feeCollateral";
    },
    {
      readonly contractName: "PregradManager";
      readonly futureId: "ArcProtocol#PregradManager";
      readonly manifestKey: "pregradManager";
      readonly resultKey: "pregradManager";
    },
  ];
  readonly defaultDeploymentFile: "deployments/arc-testnet.protocol.local.json";
  readonly defaultDeploymentId: "arc-testnet-protocol";
};
