import type { Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  createReadOnlyClient,
  createWalletClient,
} from "src/blockchain/client";
import { and, db, eq, schema } from "src/db/client";
import {
  runResolutionFinalizePass,
  type ResolutionFinalizeSkipReason,
} from "src/keeper/resolution-finalize";

import { readDevPrivateKey } from "./local-dev-chain";

/**
 * Discriminated outcome of a public settle request. Every non-`settled` kind
 * is ordinary operation rather than an error: the underlying call is
 * permissionless, so the keeper or any other finalizer may have moved the
 * market between the page render and the request landing.
 */
export type ResolutionFinalizeRequestResult =
  | { kind: "invalid_market_id"; message: string }
  | { kind: "not_found"; message: string }
  | { kind: "not_graduated"; message: string }
  | { kind: "no_pending_proposal"; message: string }
  | { kind: "window_open"; message: string }
  | { kind: "disputed"; message: string }
  | { kind: "already_resolved"; message: string }
  | { kind: "settled"; message: string; transactionHash: Hash };

/** Maps a keeper skip reason to the caller-facing refusal. */
const SKIP_RESULTS: Record<
  ResolutionFinalizeSkipReason,
  Exclude<
    ResolutionFinalizeRequestResult,
    { kind: "invalid_market_id" | "not_found" | "not_graduated" | "settled" }
  >
> = {
  already_resolved: {
    kind: "already_resolved",
    message: "Market is already settled.",
  },
  disputed: {
    kind: "disputed",
    message:
      "Resolution is disputed, so it cannot be settled here; an operator settles a disputed market.",
  },
  no_pending_proposal: {
    kind: "no_pending_proposal",
    message: "Market has no proposed resolution to settle.",
  },
  window_open: {
    kind: "window_open",
    message:
      "Dispute window is still open; the proposal cannot be settled yet.",
  },
};

/**
 * Handles a permissionless "settle this market" request (repo ADR 0024) — the
 * finalize sibling of the public graduation trigger and the resolution-check
 * poke. It exists because the keeper discovers pending proposals from the
 * indexed market status, so a proposal the indexer missed is one nothing
 * settles automatically: the market sits in ResolutionPending, winners cannot
 * redeem, and no error is logged anywhere.
 *
 * Safe unauthenticated, and deliberately unbonded. `finalizeResolution()` is
 * permissionless on the contract and takes no payment, so the server signs
 * nothing the caller could not have signed themselves — this endpoint only
 * spares them a wallet and gas. Cost is bounded by the contract rather than by
 * caller identity: the pass reads chain state first and sends no transaction
 * unless the market is genuinely settleable, so repeat requests are free reads.
 *
 * The settle itself is {@link runResolutionFinalizePass}, the keeper's own
 * duty, rather than a second implementation — the status gate, the deadline
 * gate, and the lost-race handling must not drift between the automatic and
 * manual paths.
 */
export async function requestResolutionFinalization(
  {
    chainId,
    marketId,
  }: {
    chainId: number;
    marketId: string;
  },
  {
    finalize = runResolutionFinalizePass,
  }: { finalize?: typeof runResolutionFinalizePass } = {},
): Promise<ResolutionFinalizeRequestResult> {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    return { kind: "invalid_market_id", message: "Invalid chain id." };
  }

  let parsedMarketId: bigint;

  try {
    parsedMarketId = BigInt(marketId);
  } catch {
    return { kind: "invalid_market_id", message: "Invalid market id." };
  }

  const [row] = await db
    .select({
      postgradMarket: schema.graduationFinalizedEvents.postgradMarket,
    })
    .from(schema.graduationFinalizedEvents)
    .where(
      and(
        eq(schema.graduationFinalizedEvents.chainId, chainId),
        eq(schema.graduationFinalizedEvents.marketId, parsedMarketId),
      ),
    )
    .limit(1);

  if (!row) {
    // The graduation projection is what supplies the postgrad address, so a
    // market missing from it is invisible here however healthy the chain is.
    // That is the one gap this endpoint cannot close, and saying "not
    // graduated" rather than "not found" keeps the distinction honest.
    const [market] = await db
      .select({ marketId: schema.markets.marketId })
      .from(schema.markets)
      .where(
        and(
          eq(schema.markets.chainId, chainId),
          eq(schema.markets.marketId, parsedMarketId),
        ),
      )
      .limit(1);

    return market
      ? {
          kind: "not_graduated",
          message:
            "Market has no indexed postgrad venue; settlement applies to graduated markets only.",
        }
      : { kind: "not_found", message: "Market not found." };
  }

  const outcome = await finalize({
    clients: {
      publicClient: createReadOnlyClient(),
      walletClient: createWalletClient(
        privateKeyToAccount(readDevPrivateKey()),
      ),
    },
    market: {
      chainId,
      key: `finalize:${chainId}:${marketId}`,
      label: `market ${chainId}:${marketId}`,
      marketId: parsedMarketId,
      postgradMarket: row.postgradMarket as `0x${string}`,
    },
  });

  return outcome.kind === "finalized"
    ? {
        kind: "settled",
        message: "Market settled to its proposed outcome.",
        transactionHash: outcome.transactionHash,
      }
    : SKIP_RESULTS[outcome.reason];
}
