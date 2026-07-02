import type { Address, Hex, PublicClient } from "viem";

import { sqrtPriceX96ToDisplayPriceWad } from "../price/sqrtPriceX96ToDisplayPriceWad.js";

const STATE_VIEW_SLOT0_ABI = [
  {
    inputs: [{ name: "poolId", type: "bytes32" }],
    name: "getSlot0",
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

/** Current pool price in raw v4 units and as an ADR 0009 display price. */
export type PoolDisplayPrice = {
  readonly displayPriceWad: bigint;
  readonly sqrtPriceX96: bigint;
  readonly tick: number;
};

/**
 * Reads a bounded pool's slot0 through the venue StateView and converts the
 * sqrt price into the WAD display price (collateral per one outcome token)
 * for the pool's currency orientation, so every smoke flow reports the same
 * price the ADR 0009 policy is written in.
 */
export async function readPoolDisplayPrice(args: {
  readonly collateralDecimals: number;
  readonly outcomeDecimals: number;
  readonly outcomeIsCurrency0: boolean;
  readonly poolId: Hex;
  readonly publicClient: PublicClient;
  readonly stateView: Address;
}): Promise<PoolDisplayPrice> {
  const [sqrtPriceX96, tick] = await args.publicClient.readContract({
    abi: STATE_VIEW_SLOT0_ABI,
    address: args.stateView,
    args: [args.poolId],
    functionName: "getSlot0",
  });

  return {
    displayPriceWad: sqrtPriceX96ToDisplayPriceWad({
      collateralDecimals: args.collateralDecimals,
      outcomeDecimals: args.outcomeDecimals,
      outcomeIsCurrency0: args.outcomeIsCurrency0,
      sqrtPriceX96,
    }),
    sqrtPriceX96,
    tick,
  };
}
