import { relative, resolve } from "node:path";

import type { Hex } from "viem";

import { requireNonNegativeInteger, requireString } from "../cli/requireCliValue.js";
import { readJsonFile } from "../json/jsonFile.js";
import { SMOKE_ORDER_DEPLOYMENT } from "./smokeOrderDeployment.js";

const POOL_ID_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/** Manifest the maker-order smoke flow writes for the taker-swap flow to consume. */
export type SmokeMakerOrderManifest = {
  readonly chainId: number;
  readonly generatedAt: string;
  readonly marketManifest: string;
  readonly order: {
    readonly amountIn: string;
    readonly enablePartialFill: boolean;
    readonly liquidity: string;
    readonly orderId: number;
    readonly tickLower: number;
    readonly tickUpper: number;
    readonly zeroForOne: boolean;
  };
  readonly pool: {
    readonly poolId: Hex;
    readonly side: "no" | "yes";
  };
  readonly transactions: {
    readonly createOrder: Hex;
    readonly mintCompleteSets: Hex;
  };
};

/**
 * Reads and validates the smoke maker-order manifest for this chain. Resolves
 * the path from POPCHARTS_SMOKE_ORDER_FILE or the chain default, fails with a
 * pointer to `pnpm local:smoke-maker-order` when the file is missing, and
 * rejects manifests written for a different chain.
 */
export async function readSmokeMakerOrderManifest(args: {
  readonly chainEnv: string;
  readonly env: NodeJS.ProcessEnv;
  readonly expectedChainId: number;
  readonly protocolRoot: string;
}): Promise<{ manifest: SmokeMakerOrderManifest; manifestPath: string }> {
  const manifestFile = resolve(
    args.protocolRoot,
    args.env.POPCHARTS_SMOKE_ORDER_FILE ||
      SMOKE_ORDER_DEPLOYMENT.defaultDeploymentFile(args.chainEnv),
  );
  const manifestPath = relative(args.protocolRoot, manifestFile);

  let raw: unknown;
  try {
    raw = await readJsonFile(manifestFile);
  } catch {
    throw new Error(
      `Could not read smoke maker-order manifest ${manifestPath}. Place the maker order first ` +
        "(pnpm local:smoke-maker-order or pnpm arc:testnet:smoke-maker-order).",
    );
  }

  const manifest = parseManifest(raw, manifestPath);
  if (manifest.chainId !== args.expectedChainId) {
    throw new Error(
      `Smoke maker-order manifest ${manifestPath} is for chain ${manifest.chainId}, ` +
        `but the connected chain is ${args.expectedChainId}.`,
    );
  }
  return { manifest, manifestPath };
}

function parseManifest(raw: unknown, manifestPath: string): SmokeMakerOrderManifest {
  const root = requireObject(raw, manifestPath, "manifest");
  const order = requireObject(root.order, manifestPath, "order");
  const pool = requireObject(root.pool, manifestPath, "pool");
  const transactions = requireObject(root.transactions, manifestPath, "transactions");

  const poolId = requireString(pool.poolId, `${manifestPath} pool.poolId`);
  if (!POOL_ID_PATTERN.test(poolId)) {
    throw new Error(`Expected ${manifestPath} pool.poolId to be a 32-byte hex string.`);
  }
  const side = requireString(pool.side, `${manifestPath} pool.side`);
  if (side !== "no" && side !== "yes") {
    throw new Error(`Expected ${manifestPath} pool.side to be "yes" or "no".`);
  }

  return {
    chainId: requireNonNegativeInteger(root.chainId, `${manifestPath} chainId`),
    generatedAt: requireString(root.generatedAt, `${manifestPath} generatedAt`),
    marketManifest: requireString(root.marketManifest, `${manifestPath} marketManifest`),
    order: {
      amountIn: requireString(order.amountIn, `${manifestPath} order.amountIn`),
      enablePartialFill: requireBoolean(
        order.enablePartialFill,
        `${manifestPath} order.enablePartialFill`,
      ),
      liquidity: requireString(order.liquidity, `${manifestPath} order.liquidity`),
      orderId: requireNonNegativeInteger(order.orderId, `${manifestPath} order.orderId`),
      tickLower: requireTick(order.tickLower, `${manifestPath} order.tickLower`),
      tickUpper: requireTick(order.tickUpper, `${manifestPath} order.tickUpper`),
      zeroForOne: requireBoolean(order.zeroForOne, `${manifestPath} order.zeroForOne`),
    },
    pool: { poolId: poolId as Hex, side },
    transactions: {
      createOrder: requireHash(
        transactions.createOrder,
        `${manifestPath} transactions.createOrder`,
      ),
      mintCompleteSets: requireHash(
        transactions.mintCompleteSets,
        `${manifestPath} transactions.mintCompleteSets`,
      ),
    },
  };
}

function requireObject(
  value: unknown,
  manifestPath: string,
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Smoke maker-order manifest ${manifestPath} has no ${label} object.`);
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

function requireHash(value: unknown, label: string): Hex {
  const hash = requireString(value, label);
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw new Error(`Expected ${label} to be a transaction hash.`);
  }
  return hash as Hex;
}
