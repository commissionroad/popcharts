export const pregradManagerAbi = [
  {
    inputs: [
      {
        components: [
          { name: "collateral", type: "address" },
          { name: "metadataHash", type: "bytes32" },
          { name: "openingProbabilityWad", type: "uint256" },
          { name: "liquidityParameter", type: "uint256" },
          { name: "graduationThreshold", type: "uint256" },
          { name: "graduationTime", type: "uint64" },
          { name: "resolutionTime", type: "uint64" },
        ],
        name: "params",
        type: "tuple",
      },
    ],
    name: "createMarket",
    outputs: [{ name: "marketId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "marketId", type: "uint256" },
      { indexed: true, name: "creator", type: "address" },
      { indexed: true, name: "metadataHash", type: "bytes32" },
      { indexed: false, name: "collateral", type: "address" },
      { indexed: false, name: "openingProbabilityWad", type: "uint256" },
      { indexed: false, name: "liquidityParameter", type: "uint256" },
      { indexed: false, name: "graduationThreshold", type: "uint256" },
      { indexed: false, name: "graduationTime", type: "uint64" },
      { indexed: false, name: "resolutionTime", type: "uint64" },
    ],
    name: "MarketCreated",
    type: "event",
  },
] as const;
