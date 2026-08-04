import {
  completeSetBinaryMarketAbi,
  mockCollateralAbi,
  POSTGRAD_MARKET_STATUS,
  SIDE_YES,
} from "@popcharts/protocol";
import { parseUnits, type Address } from "viem";

import { schema } from "src/db/client";

import { assertEqual } from "../asserts";
import { chainNowSeconds, resolutionRunnerTimeoutMs } from "../chain-time";
import { createLifecycleMarket } from "../market-factory";
import { waitForApiStatus, waitForIndexedRows } from "../market-checks";
import {
  setPostgradDisputeConfig,
  settleDisputedPostgradMarketAsResolver,
} from "../operator";
import {
  SCENARIO_ACCOUNTS,
  collateralAddress,
  publicClient,
  walletFor,
} from "../stack";
import { placeGraduationLiquidity } from "../pregrad-trading";
import type { Scenario } from "../report";

/**
 * ADR 0024 optimistic resolution, contested path: the resolution runner
 * proposes YES, a member of the public bonds a dispute inside the window, the
 * market freezes in `disputed` instead of finalizing, and the operator settles
 * it the other way with the resolver key — vindicating the disputer, whose
 * bond is refunded.
 *
 * This is the scenario the whole program exists for: a wrong AI verdict being
 * caught by someone other than the operator. It asserts the money paper trail
 * too, since the bond is a real value transfer (AGENTS.md invariant) — posted
 * and refunded rows must reach the indexed bond table, and the disputer's
 * collateral must come back to the cent.
 */
const DISPUTE_WINDOW_SECONDS = 60n;
const DISPUTE_BOND = "100";

export const disputeSettlement: Scenario = {
  name: "dispute-settlement",
  run: async ({ step }) => {
    const collateralDecimals = await publicClient.readContract({
      abi: mockCollateralAbi,
      address: collateralAddress,
      functionName: "decimals",
    });
    const bond = parseUnits(DISPUTE_BOND, collateralDecimals);

    // Local stacks deploy the adapter with a zero window and zero bond. Retune
    // the adapter rather than the local default: both values are stamped into
    // each market at graduation, so this market keeps them once the default is
    // handed back.
    const previousDisputeConfig = await step(
      "configure a real dispute window and bond on the adapter",
      () =>
        setPostgradDisputeConfig({
          disputeBond: bond,
          disputeWindow: DISPUTE_WINDOW_SECONDS,
        }),
    );

    let postgradMarketAddress: Address;
    let market: Awaited<ReturnType<typeof createLifecycleMarket>>;

    try {
      market = await step("create market with a YES marker", () =>
        createLifecycleMarket({
          question: `Will the disputed proposal be overturned? (run ${Date.now()})`,
          heuristicOutcome: "yes",
          graduationSeconds: 240,
          resolutionSeconds: 300,
        }),
      );

      await step("review runner approves via heuristic provider", () =>
        waitForApiStatus(market.marketId, "bootstrap", { timeoutMs: 135_000 }),
      );

      await step("traders supply both sides to threshold", () =>
        placeGraduationLiquidity({
          marketId: market.marketId,
          thresholdWad: market.graduationThresholdWad,
          yesTraderAccountIndex: SCENARIO_ACCOUNTS.disputeSettlementYes,
          noTraderAccountIndex: SCENARIO_ACCOUNTS.disputeSettlementNo,
        }),
      );

      const graduated = await step("keeper graduates the market", () =>
        waitForApiStatus(market.marketId, "graduated", {
          requirePostgrad: true,
          timeoutMs: 240_000,
        }),
      );
      postgradMarketAddress = graduated.postgrad?.marketAddress as Address;
    } finally {
      // The adapter is stack-global, so hand the local default back as soon as
      // this market has its own copy stamped in — including when a step above
      // failed.
      await setPostgradDisputeConfig(previousDisputeConfig);
    }

    await step("the graduated market carries the configured bond", async () => {
      // Without this the scenario could run against a zero window/bond and
      // prove nothing: dispute() would be unreachable and free.
      const [stampedWindow, stampedBond] = await Promise.all([
        publicClient.readContract({
          abi: completeSetBinaryMarketAbi,
          address: postgradMarketAddress,
          functionName: "disputeWindow",
        }),
        publicClient.readContract({
          abi: completeSetBinaryMarketAbi,
          address: postgradMarketAddress,
          functionName: "disputeBond",
        }),
      ]);
      assertEqual(
        "stamped dispute window",
        stampedWindow,
        DISPUTE_WINDOW_SECONDS,
      );
      assertEqual("stamped dispute bond", stampedBond, bond);
    });

    await step("resolution runner proposes YES", async () => {
      // No chain jump — see the note in happy-path.
      await waitForApiStatus(market.marketId, "resolution_pending", {
        // Derived, not hardcoded: the runner's eligibility clock is wall time
        // against the chain-anchored gate.
        timeoutMs: resolutionRunnerTimeoutMs(market.resolutionTime),
      });

      const proposedSide = await publicClient.readContract({
        abi: completeSetBinaryMarketAbi,
        address: postgradMarketAddress,
        functionName: "proposedSide",
      });
      assertEqual("proposed side", Number(proposedSide), SIDE_YES);
    });

    const disputer = walletFor(SCENARIO_ACCOUNTS.disputeSettlementDisputer);
    const balanceBeforeBond = await step(
      "a member of the public bonds a dispute",
      async () => {
        const deadline = await publicClient.readContract({
          abi: completeSetBinaryMarketAbi,
          address: postgradMarketAddress,
          functionName: "disputeDeadline",
        });
        const chainNow = await chainNowSeconds();
        if (chainNow >= deadline) {
          throw new Error(
            `dispute window closed before the disputer could act (chain ${chainNow} >= deadline ${deadline}); widen DISPUTE_WINDOW_SECONDS`,
          );
        }

        await fundDisputer(disputer, postgradMarketAddress, bond);
        const balanceBefore = await collateralBalanceOf(
          disputer.account.address,
        );

        const disputeHash = await disputer.writeContract({
          abi: completeSetBinaryMarketAbi,
          address: postgradMarketAddress,
          functionName: "dispute",
        });
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: disputeHash,
        });
        if (receipt.status !== "success") {
          throw new Error(`dispute reverted: ${disputeHash}`);
        }

        assertEqual(
          "disputer pays the bond",
          balanceBefore - (await collateralBalanceOf(disputer.account.address)),
          bond,
        );
        return balanceBefore;
      },
    );

    await step(
      "the market freezes as disputed, bond on the paper trail",
      async () => {
        const disputed = await waitForApiStatus(market.marketId, "disputed", {
          timeoutMs: 60_000,
        });
        assertEqual(
          "API status after the dispute",
          disputed.status,
          "disputed",
        );

        const status = await publicClient.readContract({
          abi: completeSetBinaryMarketAbi,
          address: postgradMarketAddress,
          functionName: "status",
        });
        assertEqual(
          "contract status after the dispute",
          Number(status),
          POSTGRAD_MARKET_STATUS.disputed,
        );

        // Two lifecycle rows (proposed, disputed) and one money row (posted).
        const disputeRows = await waitForIndexedRows(
          "dispute reaches the indexed dispute trail",
          schema.postgradDisputeEvents,
          market.marketId,
          2,
        );
        assertEqual(
          "indexed disputer",
          disputeRows.find((row) => row.kind === "disputed")?.disputer,
          disputer.account.address.toLowerCase(),
        );

        const [posted] = await waitForIndexedRows(
          "posted bond reaches the indexed money trail",
          schema.postgradDisputeBondEvents,
          market.marketId,
          1,
        );
        assertEqual("indexed bond kind", posted?.kind, "posted");
        assertEqual("indexed bond amount", posted?.amount, bond);
      },
    );

    await step("operator settles the dispute the other way", async () => {
      // The proposal was YES; settling NO is the operator overturning a wrong
      // AI verdict, which is what makes the dispute substantively right and
      // refunds the bond.
      await settleDisputedPostgradMarketAsResolver(postgradMarketAddress, "no");

      const resolved = await waitForApiStatus(market.marketId, "resolved", {
        timeoutMs: 60_000,
      });
      if (
        !resolved.resolution ||
        resolved.resolution.kind !== "resolved" ||
        resolved.resolution.winningSide !== "no"
      ) {
        throw new Error(
          `API resolution payload is not a NO resolution: ${JSON.stringify(resolved.resolution)}`,
        );
      }
    });

    await step("the vindicated disputer gets the bond back", async () => {
      assertEqual(
        "disputer collateral restored",
        await collateralBalanceOf(disputer.account.address),
        balanceBeforeBond,
      );

      const bondRows = await waitForIndexedRows(
        "refunded bond reaches the indexed money trail",
        schema.postgradDisputeBondEvents,
        market.marketId,
        2,
      );
      const refunded = bondRows.find((row) => row.kind === "refunded");
      assertEqual("indexed refund amount", refunded?.amount, bond);
      assertEqual(
        "indexed refund recipient",
        refunded?.disputer,
        disputer.account.address.toLowerCase(),
      );
    });
  },
};

/** Mints the bond for the disputer and approves the market to escrow it. */
async function fundDisputer(
  wallet: ReturnType<typeof walletFor>,
  postgradMarketAddress: Address,
  bond: bigint,
): Promise<void> {
  const mintHash = await wallet.writeContract({
    abi: mockCollateralAbi,
    address: collateralAddress,
    functionName: "mint",
    args: [wallet.account.address, bond],
  });
  await publicClient.waitForTransactionReceipt({ hash: mintHash });

  const approveHash = await wallet.writeContract({
    abi: mockCollateralAbi,
    address: collateralAddress,
    functionName: "approve",
    args: [postgradMarketAddress, bond],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
}

async function collateralBalanceOf(account: Address): Promise<bigint> {
  return await publicClient.readContract({
    abi: mockCollateralAbi,
    address: collateralAddress,
    functionName: "balanceOf",
    args: [account],
  });
}
