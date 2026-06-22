export const pregradManagerAbi = [
  {
    inputs: [
      { name: "cost", type: "uint256" },
      { name: "maxCost", type: "uint256" },
    ],
    name: "CostExceedsLimit",
    type: "error",
  },
  {
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "actual", type: "uint8" },
      { name: "expected", type: "uint8" },
    ],
    name: "InvalidMarketStatus",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidShares",
    type: "error",
  },
  {
    inputs: [{ name: "marketId", type: "uint256" }],
    name: "MarketDoesNotExist",
    type: "error",
  },
  {
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "graduationDeadline", type: "uint64" },
    ],
    name: "MarketPastGraduationDeadline",
    type: "error",
  },
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
          { name: "bypassAiResolution", type: "bool" },
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
    inputs: [
      {
        components: [
          { name: "marketId", type: "uint256" },
          { name: "side", type: "uint8" },
          { name: "shares", type: "uint256" },
          { name: "maxCost", type: "uint256" },
        ],
        name: "params",
        type: "tuple",
      },
    ],
    name: "placeReceipt",
    outputs: [{ name: "receiptId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "isTrustedCreator",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "marketId", type: "uint256" }],
    name: "marketExists",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "side", type: "uint8" },
      { name: "shares", type: "uint256" },
    ],
    name: "quoteReceipt",
    outputs: [
      {
        components: [
          { name: "cost", type: "uint256" },
          { name: "rLow", type: "int256" },
          { name: "rHigh", type: "int256" },
        ],
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
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
      { indexed: false, name: "bypassAiResolution", type: "bool" },
    ],
    name: "MarketCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "receiptId", type: "uint256" },
      { indexed: true, name: "marketId", type: "uint256" },
      { indexed: true, name: "owner", type: "address" },
      { indexed: false, name: "side", type: "uint8" },
      { indexed: false, name: "shares", type: "uint256" },
      { indexed: false, name: "cost", type: "uint256" },
      { indexed: false, name: "rLow", type: "int256" },
      { indexed: false, name: "rHigh", type: "int256" },
      { indexed: false, name: "sequence", type: "uint64" },
    ],
    name: "ReceiptPlaced",
    type: "event",
  },
] as const;
