import { markets } from "./fixtures";

export function getMarketById(id: string) {
  return markets.find((market) => market.id === id);
}

export function getMarkets() {
  return markets;
}
