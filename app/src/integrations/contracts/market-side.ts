// The MarketTypes.Side converters (YES = 0, NO = 1) come from the protocol
// workspace package, the single home of the contract side encoding. This
// re-export keeps protocol imports quarantined under integrations/contracts:
// app code imports from here, never from @popcharts/protocol directly.
export {
  contractSideToMarketSide,
  marketSideToContractSide,
} from "@popcharts/protocol/market-side";
