import type { PublicClient } from "viem";

import type { MarketSide } from "@/domain/markets/types";

import { contractSideToMarketSide } from "./market-side";
import { completeSetBinaryMarketAbi, POSTGRAD_MARKET_STATUS } from "./postgrad-venue";

/**
 * Where a postgrad market sits in the propose → dispute → finalize window
 * (ADR 0024). `pending` is the only phase in which `dispute()` can succeed;
 * `disputed` means finalization is frozen for operator adjudication; `none`
 * covers every status outside the window, including a market that never
 * opened one.
 */
export type MarketDisputePhase = "disputed" | "none" | "pending";

/**
 * The on-chain dispute state of one postgrad market, read straight from the
 * contract. The app reads this rather than the indexed market status because
 * the dispute states are not projected into the database yet, and because a
 * bond is real money: the amount and deadline a user acts on must come from
 * the contract that will enforce them.
 */
export type MarketDisputeSnapshot = {
  /** Bond a non-resolver disputer must post, in raw collateral units. */
  bond: bigint;
  /**
   * Bond the market currently holds in escrow for the active dispute — zero
   * until someone disputes, and zero for the resolver's free self-dispute.
   * Read rather than inferred from `bond`: it is the money actually at stake.
   */
  bondHeld: bigint;
  /** Precision of the collateral the bond is denominated in. */
  collateralDecimals: number;
  /** Unix seconds at which the window closes; null outside an open window. */
  deadline: number | null;
  /** Account that disputed, or null when none has. */
  disputer: `0x${string}` | null;
  phase: MarketDisputePhase;
  /** Side the resolver proposed; null outside an open window. */
  proposedSide: MarketSide | null;
  /** The account whose dispute is bond-free (the operator-override path). */
  resolver: `0x${string}`;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Reads a postgrad market's dispute state. The proposal reads (`proposedSide`,
 * `disputeDeadline`) revert outside an open window, so they are issued only
 * after the status read proves one is open — batching all of them would fail
 * the whole snapshot on every ordinary market.
 */
export async function readMarketDisputeState({
  marketAddress,
  publicClient,
}: {
  marketAddress: `0x${string}`;
  publicClient: PublicClient;
}): Promise<MarketDisputeSnapshot> {
  const market = { abi: completeSetBinaryMarketAbi, address: marketAddress } as const;
  const [status, bond, bondHeld, disputer, resolver, collateralDecimals] =
    await Promise.all([
      publicClient.readContract({ ...market, functionName: "status" }),
      publicClient.readContract({ ...market, functionName: "disputeBond" }),
      publicClient.readContract({ ...market, functionName: "disputeBondHeld" }),
      publicClient.readContract({ ...market, functionName: "disputer" }),
      publicClient.readContract({ ...market, functionName: "resolver" }),
      publicClient.readContract({ ...market, functionName: "collateralDecimals" }),
    ]);
  const phase = toDisputePhase(status);
  const proposal =
    phase === "none"
      ? null
      : await Promise.all([
          publicClient.readContract({ ...market, functionName: "proposedSide" }),
          publicClient.readContract({ ...market, functionName: "disputeDeadline" }),
        ]);

  return {
    bond,
    bondHeld,
    collateralDecimals,
    deadline: proposal === null ? null : Number(proposal[1]),
    disputer: disputer === ZERO_ADDRESS ? null : disputer,
    phase,
    proposedSide: proposal === null ? null : contractSideToMarketSide(proposal[0]),
    resolver,
  };
}

function toDisputePhase(status: number): MarketDisputePhase {
  if (status === POSTGRAD_MARKET_STATUS.resolutionPending) {
    return "pending";
  }

  return status === POSTGRAD_MARKET_STATUS.disputed ? "disputed" : "none";
}
