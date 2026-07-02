import { relative, resolve } from "node:path";

import type { Address, Hex } from "viem";

import {
  requireAddress,
  requireNonNegativeInteger,
  requireString,
} from "../cli/requireCliValue.js";
import { readJsonFile } from "../json/jsonFile.js";
import { COMPLETE_SET_MARKET_DEPLOYMENT } from "./completeSetMarketDeployment.js";

const POOL_ID_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/** Sorted v4 pool key recorded by the market creation script. */
export type CompleteSetMarketPoolKey = {
  readonly currency0: Address;
  readonly currency1: Address;
  readonly fee: number;
  readonly hooks: Address;
  readonly tickSpacing: number;
};

/** One outcome pool entry of a complete-set market manifest. */
export type CompleteSetMarketPool = {
  readonly boundLowerTick: number;
  readonly boundUpperTick: number;
  readonly outcomeIsCurrency0: boolean;
  readonly outcomeToken: Address;
  readonly poolId: Hex;
  readonly poolKey: CompleteSetMarketPoolKey;
};

/** Manifest fields the smoke flows rely on, produced by `pnpm local:create-complete-set-market`. */
export type CompleteSetMarketManifestData = {
  readonly chainId: number;
  readonly collateral: {
    readonly address: Address;
    readonly decimals: number;
  };
  readonly market: {
    readonly address: Address;
    readonly noToken: Address;
    readonly outcomeDecimals: number;
    readonly resolver: Address;
    readonly symbol: string;
    readonly yesToken: Address;
  };
  readonly pools: {
    readonly no: CompleteSetMarketPool;
    readonly yes: CompleteSetMarketPool;
  };
  readonly venue: {
    readonly boundedHook: Address;
    readonly orderManager: Address;
    readonly poolManager: Address;
    readonly poolTickBounds: Address;
    readonly stateView: Address;
  };
};

/**
 * Reads and validates the complete-set market manifest a smoke flow targets.
 * Resolves the manifest path from POPCHARTS_MARKET_DEPLOYMENT_FILE (falling
 * back to the default path for POPCHARTS_MARKET_SYMBOL on this chain), fails
 * with a pointer to the producing command when the file is missing, and
 * rejects manifests written for a different chain.
 */
export async function readCompleteSetMarketManifest(args: {
  readonly chainEnv: string;
  readonly env: NodeJS.ProcessEnv;
  readonly expectedChainId: number;
  readonly protocolRoot: string;
}): Promise<{ manifest: CompleteSetMarketManifestData; manifestPath: string }> {
  const marketSymbol =
    args.env.POPCHARTS_MARKET_SYMBOL ?? COMPLETE_SET_MARKET_DEPLOYMENT.defaultMarketSymbol;
  const manifestFile = resolve(
    args.protocolRoot,
    args.env.POPCHARTS_MARKET_DEPLOYMENT_FILE ||
      COMPLETE_SET_MARKET_DEPLOYMENT.defaultDeploymentFile(args.chainEnv, marketSymbol),
  );
  const manifestPath = relative(args.protocolRoot, manifestFile);

  let raw: unknown;
  try {
    raw = await readJsonFile(manifestFile);
  } catch {
    throw new Error(
      `Could not read market manifest ${manifestPath}. Create the market first ` +
        "(pnpm local:create-complete-set-market or pnpm arc:testnet:create-market), or point " +
        "POPCHARTS_MARKET_DEPLOYMENT_FILE at an existing market manifest.",
    );
  }

  const manifest = parseManifest(raw, manifestPath);
  if (manifest.chainId !== args.expectedChainId) {
    throw new Error(
      `Market manifest ${manifestPath} is for chain ${manifest.chainId}, ` +
        `but the connected chain is ${args.expectedChainId}.`,
    );
  }
  return { manifest, manifestPath };
}

function parseManifest(raw: unknown, manifestPath: string): CompleteSetMarketManifestData {
  const root = requireObject(raw, manifestPath, "manifest");
  const collateral = requireObject(root.collateral, manifestPath, "collateral");
  const market = requireObject(root.market, manifestPath, "market");
  const pools = requireObject(root.pools, manifestPath, "pools");
  const venue = requireObject(root.venue, manifestPath, "venue");

  return {
    chainId: requireNonNegativeInteger(root.chainId, `${manifestPath} chainId`),
    collateral: {
      address: requireAddress(collateral.address, `${manifestPath} collateral.address`),
      decimals: requireNonNegativeInteger(
        collateral.decimals,
        `${manifestPath} collateral.decimals`,
      ),
    },
    market: {
      address: requireAddress(market.address, `${manifestPath} market.address`),
      noToken: requireAddress(market.noToken, `${manifestPath} market.noToken`),
      outcomeDecimals: requireNonNegativeInteger(
        market.outcomeDecimals,
        `${manifestPath} market.outcomeDecimals`,
      ),
      resolver: requireAddress(market.resolver, `${manifestPath} market.resolver`),
      symbol: requireString(market.symbol, `${manifestPath} market.symbol`),
      yesToken: requireAddress(market.yesToken, `${manifestPath} market.yesToken`),
    },
    pools: {
      no: parsePool(pools.no, manifestPath, "pools.no"),
      yes: parsePool(pools.yes, manifestPath, "pools.yes"),
    },
    venue: {
      boundedHook: requireAddress(venue.boundedHook, `${manifestPath} venue.boundedHook`),
      orderManager: requireAddress(venue.orderManager, `${manifestPath} venue.orderManager`),
      poolManager: requireAddress(venue.poolManager, `${manifestPath} venue.poolManager`),
      poolTickBounds: requireAddress(venue.poolTickBounds, `${manifestPath} venue.poolTickBounds`),
      stateView: requireAddress(venue.stateView, `${manifestPath} venue.stateView`),
    },
  };
}

function parsePool(raw: unknown, manifestPath: string, label: string): CompleteSetMarketPool {
  const pool = requireObject(raw, manifestPath, label);
  const poolKey = requireObject(pool.poolKey, manifestPath, `${label}.poolKey`);
  const poolId = requireString(pool.poolId, `${manifestPath} ${label}.poolId`);
  if (!POOL_ID_PATTERN.test(poolId)) {
    throw new Error(`Expected ${manifestPath} ${label}.poolId to be a 32-byte hex string.`);
  }

  return {
    boundLowerTick: requireTick(pool.boundLowerTick, `${manifestPath} ${label}.boundLowerTick`),
    boundUpperTick: requireTick(pool.boundUpperTick, `${manifestPath} ${label}.boundUpperTick`),
    outcomeIsCurrency0: requireBoolean(
      pool.outcomeIsCurrency0,
      `${manifestPath} ${label}.outcomeIsCurrency0`,
    ),
    outcomeToken: requireAddress(pool.outcomeToken, `${manifestPath} ${label}.outcomeToken`),
    poolId: poolId as Hex,
    poolKey: {
      currency0: requireAddress(poolKey.currency0, `${manifestPath} ${label}.poolKey.currency0`),
      currency1: requireAddress(poolKey.currency1, `${manifestPath} ${label}.poolKey.currency1`),
      fee: requireNonNegativeInteger(poolKey.fee, `${manifestPath} ${label}.poolKey.fee`),
      hooks: requireAddress(poolKey.hooks, `${manifestPath} ${label}.poolKey.hooks`),
      tickSpacing: requireTick(poolKey.tickSpacing, `${manifestPath} ${label}.poolKey.tickSpacing`),
    },
  };
}

function requireObject(
  value: unknown,
  manifestPath: string,
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Market manifest ${manifestPath} has no ${label} object.`);
  }
  return value as Record<string, unknown>;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Expected ${label} to be a boolean.`);
  }
  return value;
}

function requireTick(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`Expected ${label} to be an integer.`);
  }
  return value;
}
