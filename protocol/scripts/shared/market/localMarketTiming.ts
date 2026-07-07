const DAY_SECONDS = 24n * 60n * 60n;

export const DEFAULT_GRADUATION_SECONDS = 7n * DAY_SECONDS;
export const DEFAULT_RESOLUTION_SECONDS = 14n * DAY_SECONDS;

export type MarketTiming = {
  graduationSeconds: bigint;
  resolutionSeconds: bigint;
};

/**
 * Picks the timestamp local market deadlines are computed from. An idle local
 * chain mines the next block at wall-clock time, while a time-jumped chain
 * mines it after the latest block — so the deadline anchor is whichever clock
 * is further along, keeping deadlines in the future when the creation
 * transaction mines.
 */
export function resolveDeadlineAnchor(latestBlockTimestamp: bigint, nowSeconds: bigint): bigint {
  return latestBlockTimestamp > nowSeconds ? latestBlockTimestamp : nowSeconds;
}

export function readMarketTiming(env: NodeJS.ProcessEnv = process.env): MarketTiming {
  const graduationSeconds = readPositiveSeconds(
    env,
    "LOCAL_MARKET_GRADUATION_SECONDS",
    DEFAULT_GRADUATION_SECONDS,
  );
  const resolutionSeconds = readPositiveSeconds(
    env,
    "LOCAL_MARKET_RESOLUTION_SECONDS",
    DEFAULT_RESOLUTION_SECONDS,
  );

  if (resolutionSeconds <= graduationSeconds) {
    throw new Error(
      "LOCAL_MARKET_RESOLUTION_SECONDS must be greater than " + "LOCAL_MARKET_GRADUATION_SECONDS.",
    );
  }

  return { graduationSeconds, resolutionSeconds };
}

function readPositiveSeconds(env: NodeJS.ProcessEnv, name: string, fallback: bigint): bigint {
  const value = env[name];

  if (!value) {
    return fallback;
  }

  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer number of seconds.`);
  }

  return BigInt(value);
}
