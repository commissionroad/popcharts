import {
  COMPLETE_SET_PRICE_POLICY,
  clampDisplayPriceWad,
  tickToDisplayPriceWad,
  WAD,
  wadToNumber,
} from "@popcharts/protocol";
import { parseAbi } from "viem";

/**
 * Venue price derivation shared by the API's read services and the indexer's
 * priced-tick emit (repo ADR 0025). Moved here from `api/services` when the
 * indexer became a second consumer: the indexer must not import API services,
 * and a mirrored copy of a price formula is exactly the drift ADR 0025 exists
 * to remove. The API modules re-export these under their original names, so
 * their call sites and tests are unchanged.
 */

/**
 * Converts a WAD display price (collateral per outcome token) into the cents
 * the chart plots. A token pays one collateral when its outcome wins, so its
 * price *is* the implied probability and 1 WAD is 100 cents.
 *
 * Deliberately *not* rounded to whole cents. The pre-graduation half of the
 * same chart plots `marginalPriceCents`, which is fractional and rounds only
 * where it is displayed — so rounding here would make the venue half of one
 * line stair-step while the LMSR half stayed smooth. It also erases real
 * movement: a bounded pool can take six swaps inside a single cent, which
 * plots as a flat line if the derivation has already thrown the detail away.
 */
export function displayPriceWadToCents(displayPriceWad: bigint): number {
  return (Number(displayPriceWad) / Number(WAD)) * 100;
}

/**
 * Derives the market's closing YES probability from its locked virtual LMSR
 * state, clamped into the ADR 0009 display-price band. The postgrad pools
 * open where the pregrad book closed, so the handoff does not jump price.
 */
export function closingYesDisplayPriceWad({
  liquidityParameter,
  noShares,
  openingProbabilityWad,
  yesShares,
}: {
  liquidityParameter: bigint;
  noShares: bigint;
  openingProbabilityWad: bigint;
  yesShares: bigint;
}): bigint {
  const b = wadToNumber(liquidityParameter);
  const opening = Math.min(
    Math.max(wadToNumber(openingProbabilityWad), 1e-9),
    1 - 1e-9,
  );

  if (!(b > 0)) {
    return clampDisplayPriceWad(openingProbabilityWad);
  }

  const exponent =
    (wadToNumber(yesShares) - wadToNumber(noShares)) / b +
    Math.log(opening / (1 - opening));
  const probability = 1 / (1 + Math.exp(-exponent));

  return clampDisplayPriceWad(BigInt(Math.round(probability * 1e18)));
}

/**
 * Cents a venue pool opens at: the pregrad book's closing YES probability for
 * the YES pool, its complement (clamped into the ADR 0009 band) for the NO
 * pool. This mirrors `wirePostgradMarketVenue`, which initializes the pools
 * from the same closing price — so it reproduces the actual opening price by
 * construction. It is the forward-fill fallback for a pool that has not yet
 * taken a swap.
 */
export function venueOpeningCents(
  market: {
    liquidityParameter: bigint;
    noShares: bigint;
    openingProbabilityWad: bigint;
    yesShares: bigint;
  },
  side: "yes" | "no",
): number {
  const yesDisplayPriceWad = closingYesDisplayPriceWad(market);

  return side === "yes"
    ? displayPriceWadToCents(yesDisplayPriceWad)
    : displayPriceWadToCents(clampDisplayPriceWad(WAD - yesDisplayPriceWad));
}

/**
 * Cents at a raw pool tick, oriented by which sorted currency the outcome
 * token is. Chains the exact v4 tick→sqrt-price math through the ADR 0009
 * display-price rescaling — one call, so the indexer and the API cannot
 * disagree on the conversion.
 */
export function venueTickToCents({
  collateralDecimals,
  outcomeIsCurrency0,
  tick,
}: {
  collateralDecimals: number;
  outcomeIsCurrency0: boolean;
  tick: number;
}): number {
  return displayPriceWadToCents(
    tickToDisplayPriceWad({
      collateralDecimals,
      outcomeDecimals: COMPLETE_SET_PRICE_POLICY.outcomeDecimals,
      outcomeIsCurrency0,
      tick,
    }),
  );
}

// Hand-written third-party surface, permitted by the ABI rule: collateral is
// any standard ERC20 (native USDC on testnet), not a first-party contract with
// a generated ABI. Moved verbatim from api/services/postgrad-venue.
const ERC20_DECIMALS_ABI = parseAbi([
  "function decimals() view returns (uint8)",
]);

/** The narrow chain-read surface a decimals reader needs. */
export type Erc20DecimalsClient = {
  readContract: (args: {
    abi: typeof ERC20_DECIMALS_ABI;
    address: `0x${string}`;
    functionName: "decimals";
  }) => Promise<number>;
};

/**
 * Builds a memoised per-collateral decimals reader over the given client.
 * ERC20 decimals are immutable, so one chain read per collateral per process
 * is the steady state; the API and the indexer each instantiate one over
 * their own client rather than sharing a live connection across layers.
 */
export function createCollateralDecimalsReader(
  client: () => Erc20DecimalsClient,
): (collateral: `0x${string}`) => Promise<number> {
  const cache = new Map<string, number>();

  return async (collateral) => {
    const cached = cache.get(collateral.toLowerCase());

    if (cached !== undefined) {
      return cached;
    }

    const decimals = await client().readContract({
      abi: ERC20_DECIMALS_ABI,
      address: collateral,
      functionName: "decimals",
    });
    cache.set(collateral.toLowerCase(), decimals);

    return decimals;
  };
}
