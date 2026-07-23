import {
  createPublicClient,
  createWalletClient,
  http,
  maxUint256,
  parseAbi,
} from "viem";

import { pregradManagerAbi } from "@/integrations/contracts/pregrad-manager";

import type { LifecycleEnv } from "./lifecycle";
import { TEST_WALLET_ADDRESS } from "./test-wallet";

/**
 * Assembles a pregrad receipt book on-chain for the partial-clearing journey.
 * The UI ticket only takes a collateral budget, which is too coarse to size the
 * price bands a band-pass split depends on, so the book is placed by share
 * count through Hardhat's json-rpc signing (no keys in the suite) — all from
 * the injected test wallet, so the browser redeems the same receipts on
 * /portfolio. There is no keeper in the e2e stack, so the whole book can be
 * assembled before graduation with no auto-graduation race.
 */

const SIDE_YES = 0;
const SIDE_NO = 1;
const QUOTE_SLIPPAGE_BPS = 1_000n;
const MAX_BALANCED_ROUNDS = 4;

// MockCollateral is a local-only mock with no generated ABI; this minimal
// surface is hand-written (the first-party manager uses its generated ABI).
const collateralFaucetAbi = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

function bookClients(env: LifecycleEnv) {
  const account = TEST_WALLET_ADDRESS as `0x${string}`;
  return {
    account,
    publicClient: createPublicClient({ transport: http(env.rpcUrl) }),
    walletClient: createWalletClient({ account, transport: http(env.rpcUrl) }),
  };
}

type BookClients = ReturnType<typeof bookClients>;

/**
 * Places a balanced book to the graduation threshold (the retained bands) plus
 * a one-sided YES excess (the refunded band), so band-pass clearing prorates
 * the crowded YES side to refund while the matched cap still clears the
 * threshold. Assumes the test wallet is already funded with collateral.
 */
export async function assemblePartialClearingBook(
  env: LifecycleEnv,
  marketId: bigint
): Promise<void> {
  const clients = bookClients(env);
  await ensureManagerApproval(env, clients);

  const config = await clients.publicClient.readContract({
    abi: pregradManagerAbi,
    address: env.pregradManagerAddress,
    functionName: "getMarketConfig",
    args: [marketId],
  });

  await placeBalancedToThreshold(env, marketId, config.graduationThreshold, clients);
  // One YES-only receipt on top: YES becomes the crowded side, and its excess
  // prorates to refund while the matched cap stays at the threshold.
  await placeReceipt(env, marketId, SIDE_YES, config.graduationThreshold / 4n, clients);
}

/**
 * Buys balanced YES/NO volume until yesShares, noShares, and total escrow all
 * cover the threshold. Buying equal shares on both sides raises escrow by that
 * amount under LMSR; the loop re-reads state each round to absorb rounding.
 */
async function placeBalancedToThreshold(
  env: LifecycleEnv,
  marketId: bigint,
  thresholdWad: bigint,
  clients: BookClients
): Promise<void> {
  for (let round = 0; round < MAX_BALANCED_ROUNDS; round += 1) {
    const state = await clients.publicClient.readContract({
      abi: pregradManagerAbi,
      address: env.pregradManagerAddress,
      functionName: "getMarketState",
      args: [marketId],
    });
    const yesDeficit = clampToZero(thresholdWad - state.yesShares);
    const noDeficit = clampToZero(thresholdWad - state.noShares);
    const escrowDeficit = clampToZero(thresholdWad - state.totalEscrowed);
    if (yesDeficit === 0n && noDeficit === 0n && escrowDeficit === 0n) {
      return;
    }
    const buys = [
      { shares: maxBigInt(yesDeficit, escrowDeficit), side: SIDE_YES },
      { shares: maxBigInt(noDeficit, escrowDeficit), side: SIDE_NO },
    ].filter((buy) => buy.shares > 0n);
    for (const buy of buys) {
      await placeReceipt(env, marketId, buy.side, buy.shares, clients);
    }
  }
  throw new Error(
    `Market ${marketId} did not reach its graduation threshold after ${MAX_BALANCED_ROUNDS} rounds.`
  );
}

/** Quotes and places one receipt by share count (funding is done up front). */
async function placeReceipt(
  env: LifecycleEnv,
  marketId: bigint,
  side: number,
  sharesWad: bigint,
  clients: BookClients
): Promise<void> {
  const quote = await clients.publicClient.readContract({
    abi: pregradManagerAbi,
    address: env.pregradManagerAddress,
    functionName: "quoteReceipt",
    args: [marketId, side, sharesWad],
  });
  const maxCost = quote.cost + (quote.cost * QUOTE_SLIPPAGE_BPS) / 10_000n;

  const hash = await clients.walletClient.writeContract({
    abi: pregradManagerAbi,
    address: env.pregradManagerAddress,
    functionName: "placeReceipt",
    args: [{ marketId, maxCost, shares: sharesWad, side }],
    account: clients.account,
    chain: null,
  });
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`placeReceipt reverted: ${hash}`);
  }
}

/** Grants the manager an unbounded allowance once, so placements never wait. */
async function ensureManagerApproval(
  env: LifecycleEnv,
  clients: BookClients
): Promise<void> {
  const allowance = await clients.publicClient.readContract({
    abi: collateralFaucetAbi,
    address: env.collateralAddress,
    functionName: "allowance",
    args: [clients.account, env.pregradManagerAddress],
  });
  if (allowance >= maxUint256 / 2n) {
    return;
  }
  const hash = await clients.walletClient.writeContract({
    abi: collateralFaucetAbi,
    address: env.collateralAddress,
    functionName: "approve",
    args: [env.pregradManagerAddress, maxUint256],
    account: clients.account,
    chain: null,
  });
  await clients.publicClient.waitForTransactionReceipt({ hash });
}

function clampToZero(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}
