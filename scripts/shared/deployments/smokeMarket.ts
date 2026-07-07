import { parseLabeledJson } from "../json/parseLabeledJson.ts";

/**
 * Payload of the `LOCAL_CHAIN_SMOKE_MARKET=` line emitted by
 * `protocol/scripts/create-local-market.ts` — the machine-readable record of a
 * freshly created local market. The protocol helper emits a wider summary;
 * these are the fields the root orchestrators rely on.
 */
export type SmokeMarket = {
  readonly chainId: number;
  readonly marketId: string;
  readonly metadataHash: string;
};

export function parseSmokeMarket(stdout: string): SmokeMarket {
  const market = parseLabeledJson<Partial<SmokeMarket>>(
    stdout,
    "LOCAL_CHAIN_SMOKE_MARKET",
  );

  if (typeof market.chainId !== "number") {
    throw new Error("LOCAL_CHAIN_SMOKE_MARKET is missing a numeric chainId.");
  }
  if (typeof market.marketId !== "string" || market.marketId.length === 0) {
    throw new Error("LOCAL_CHAIN_SMOKE_MARKET is missing a marketId.");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(market.metadataHash ?? "")) {
    throw new Error("LOCAL_CHAIN_SMOKE_MARKET is missing a metadataHash.");
  }

  return {
    chainId: market.chainId,
    marketId: market.marketId,
    metadataHash: market.metadataHash as string,
  };
}
