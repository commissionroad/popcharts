import type { PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";

import { readMarketDisputeState } from "./market-dispute-state";
import { POSTGRAD_MARKET_STATUS } from "./postgrad-venue";

const BOND = 100n * 10n ** 18n;
const ACCOUNT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const RESOLVER = "0x4444444444444444444444444444444444444444" as const;
const MARKET = "0x2222222222222222222222222222222222222222" as const;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

describe("readMarketDisputeState", () => {
  it("reads an open window, including the proposal-only reads", async () => {
    const { publicClient, readContract } = mockPublicClient({
      disputer: ZERO_ADDRESS,
    });

    await expect(
      readMarketDisputeState({ marketAddress: MARKET, publicClient })
    ).resolves.toEqual({
      bond: BOND,
      bondHeld: 0n,
      collateralDecimals: 18,
      deadline: 1_700_000_000,
      // The zero address means nobody has disputed, not an account of zeroes.
      disputer: null,
      phase: "pending",
      proposedSide: "yes",
      resolver: RESOLVER,
    });
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "disputeDeadline" })
    );
  });

  it("reports a disputed market with its disputer and proposed side", async () => {
    const { publicClient } = mockPublicClient({
      bondHeld: BOND,
      proposedSide: 1,
      status: POSTGRAD_MARKET_STATUS.disputed,
    });

    await expect(
      readMarketDisputeState({ marketAddress: MARKET, publicClient })
    ).resolves.toMatchObject({
      bondHeld: BOND,
      disputer: ACCOUNT,
      phase: "disputed",
      proposedSide: "no",
    });
  });

  it.each([
    ["trading", POSTGRAD_MARKET_STATUS.trading],
    ["resolved", POSTGRAD_MARKET_STATUS.resolved],
    ["cancelled", POSTGRAD_MARKET_STATUS.cancelled],
  ])("skips the reverting proposal reads on a %s market", async (_label, status) => {
    const { publicClient, readContract } = mockPublicClient({ status });

    await expect(
      readMarketDisputeState({ marketAddress: MARKET, publicClient })
    ).resolves.toMatchObject({ deadline: null, phase: "none", proposedSide: null });
    expect(readContract).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "proposedSide" })
    );
  });
});

function mockPublicClient({
  bondHeld = 0n,
  disputer = ACCOUNT,
  proposedSide = 0,
  status = POSTGRAD_MARKET_STATUS.resolutionPending,
}: {
  bondHeld?: bigint;
  disputer?: `0x${string}`;
  proposedSide?: number;
  status?: number;
} = {}) {
  const reads: Record<string, unknown> = {
    collateralDecimals: 18,
    disputeBond: BOND,
    disputeBondHeld: bondHeld,
    disputeDeadline: 1_700_000_000n,
    disputer,
    proposedSide,
    resolver: RESOLVER,
    status,
  };
  const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
    if (!(functionName in reads)) {
      throw new Error(`Unexpected read ${functionName}`);
    }

    return reads[functionName];
  });

  return { publicClient: { readContract } as unknown as PublicClient, readContract };
}
