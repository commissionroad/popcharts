import "./env";

import { mnemonicToAccount } from "viem/accounts";
import type { Address } from "viem";

import {
  createReadOnlyClient,
  createWalletClient,
  type BlockchainClient,
  type BlockchainWalletClient,
} from "src/blockchain/client";
import { config } from "src/config";

/**
 * Shared context for lifecycle nightly scenarios: chain clients, the local
 * dev account allocation, and the read API. Everything binds to the running
 * local stack described by the environment — the runner never boots services
 * itself (the orchestrator owns process lifecycles).
 */

// Hardhat's default in-memory mnemonic; the devchain pre-funds indexes 0-19.
// Also spelled out in server/scripts/bot-trade.ts, which lives outside this
// package's typecheck root and deliberately avoids src imports (it must run
// without the server config env), so the two copies cannot share a module.
const LOCAL_DEV_MNEMONIC =
  "test test test test test test test test test test test junk";

/**
 * Account allocation. Index 0 signs for every server-side service (deployer,
 * manager, keeper, review/resolution runners) — scenarios must never send
 * from it or they race service nonces. The creator index is distinct from the
 * trader range so creation-fee accounting never mixes into trade balances.
 */
export const CREATOR_ACCOUNT_INDEX = 5;
export const FIRST_TRADER_ACCOUNT_INDEX = 10;

export const chainId = config.chainId;
export const pregradManagerAddress = config.contracts.pregradManager;

export const collateralAddress = requireCollateralAddress();

export const apiBaseUrl = `http://127.0.0.1:${config.apiPort}`;

// HTTP-only on purpose: the harness polls, and the indexer-style WebSocket
// client's reconnect loop would keep the runner process alive after the
// scenario summary.
export const publicClient: BlockchainClient = createReadOnlyClient();

const walletCache = new Map<number, BlockchainWalletClient>();

export function walletFor(accountIndex: number): BlockchainWalletClient {
  const cached = walletCache.get(accountIndex);
  if (cached) {
    return cached;
  }

  const wallet = createWalletClient(
    mnemonicToAccount(LOCAL_DEV_MNEMONIC, { addressIndex: accountIndex }),
  );
  walletCache.set(accountIndex, wallet);
  return wallet;
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `GET ${path} returned ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  }

  return (await response.json()) as T;
}

/** The market read model served by GET /markets/:chainId/:marketId. */
export type ApiMarket = {
  aiReview?: { reasons?: string[]; verdict: string };
  marketId: string;
  metadataHash: string;
  postgrad?: {
    marketAddress?: string;
    noTokenAddress?: string;
    yesTokenAddress?: string;
  };
  resolution?: { kind: string; winningSide?: string | null };
  status: string;
  totalEscrowed: string;
};

export async function fetchApiMarket(
  marketId: bigint,
): Promise<ApiMarket | null> {
  const response = await fetch(`${apiBaseUrl}/markets/${chainId}/${marketId}`, {
    headers: { accept: "application/json" },
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `GET /markets/${chainId}/${marketId} returned ${response.status}`,
    );
  }

  return (await response.json()) as ApiMarket;
}

function requireCollateralAddress(): Address {
  const value =
    process.env.LOCAL_COLLATERAL_ADDRESS ?? process.env.COLLATERAL_ADDRESS;

  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(
      "LOCAL_COLLATERAL_ADDRESS is missing. Run the lifecycle suite through " +
        "scripts/local-lifecycle-nightly.ts, or point " +
        "POPCHARTS_LOCAL_CHAIN_ENV_FILE at a stack-generated env file.",
    );
  }

  return value as Address;
}
