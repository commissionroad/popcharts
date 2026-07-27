import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

import { COMPLETE_SET_PRICE_POLICY } from "../price/completeSetPricePolicy.js";

/** Sorted v4 pool key for one outcome token traded against market collateral. */
export type CompleteSetMarketPoolKey = {
  readonly currency0: Address;
  readonly currency1: Address;
  readonly fee: number;
  readonly hooks: Address;
  readonly tickSpacing: number;
};

/**
 * Builds the sorted v4 pool key for an outcome token against collateral:
 * currencies sort by address, fee and tick spacing come from the ADR 0009
 * complete-set policy, and the hook is the market venue's bounded hook.
 *
 * The key is a pool's identity, so every caller that derives one — the
 * graduation wiring, the indexer's pool mapping, the app's trade ticket, and
 * the local bot script — must derive it here. Two callers computing the key
 * independently would not fail loudly on divergence; they would silently
 * address a different (usually nonexistent) pool.
 */
export function buildOutcomePoolKey({
  boundedHook,
  collateral,
  outcomeToken,
}: {
  boundedHook: Address;
  collateral: Address;
  outcomeToken: Address;
}): { key: CompleteSetMarketPoolKey; outcomeIsCurrency0: boolean } {
  const outcomeIsCurrency0 = BigInt(outcomeToken.toLowerCase()) < BigInt(collateral.toLowerCase());

  return {
    key: {
      currency0: outcomeIsCurrency0 ? outcomeToken : collateral,
      currency1: outcomeIsCurrency0 ? collateral : outcomeToken,
      fee: COMPLETE_SET_PRICE_POLICY.poolFee,
      hooks: boundedHook,
      tickSpacing: COMPLETE_SET_PRICE_POLICY.tickSpacing,
    },
    outcomeIsCurrency0,
  };
}

/**
 * Computes the v4 pool id: keccak256 of the ABI-encoded pool key. The tuple
 * below must stay field-for-field identical to the on-chain PoolKey struct —
 * the pool singleton derives ids the same way, so any drift here produces an
 * id that addresses no pool rather than an error.
 */
export function computePoolId(key: CompleteSetMarketPoolKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        {
          components: [
            { name: "currency0", type: "address" },
            { name: "currency1", type: "address" },
            { name: "fee", type: "uint24" },
            { name: "tickSpacing", type: "int24" },
            { name: "hooks", type: "address" },
          ],
          type: "tuple",
        },
      ],
      [
        {
          currency0: key.currency0,
          currency1: key.currency1,
          fee: key.fee,
          hooks: key.hooks,
          tickSpacing: key.tickSpacing,
        },
      ],
    ),
  );
}
