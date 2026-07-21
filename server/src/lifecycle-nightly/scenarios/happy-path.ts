import {
  completeSetBinaryMarketAbi,
  executeCompleteSetArb,
  MARKET_STATUS,
  outcomeTokenAbi,
  SIDE_YES,
} from "@popcharts/protocol";
import { parseUnits, type Address, type PublicClient } from "viem";

import {
  buildGraduatedMarketManifest,
  createVenueContractWriter,
} from "src/api/services/postgrad-venue";
import { config } from "src/config";
import { and, db, eq, schema } from "src/db/client";

import { assertEqual } from "../asserts";
import {
  chainNowSeconds,
  jumpChainTimeTo,
  resolutionRunnerTimeoutMs,
} from "../chain-time";
import { createLifecycleMarket } from "../market-factory";
import {
  assertChainStatus,
  waitForApiStatus,
  waitForIndexedRows,
} from "../market-checks";
import { assertMarketPaperTrail } from "../paper-trail";
import {
  SCENARIO_ACCOUNTS,
  collateralAddress,
  publicClient,
  walletFor,
  type ApiMarket,
} from "../stack";
import { placeGraduationLiquidity } from "../pregrad-trading";
import type { Scenario } from "../report";

/**
 * ADR 0014 happy path: create → AI approve → receipt trading → graduation
 * threshold reached → clearing → postgrad trading → resolution → redemption,
 * asserting API, database, and on-chain state at each transition. Every
 * transition rides the real services — the heuristic review runner approves,
 * the keeper's graduation pass clears and finalizes, and the heuristic
 * resolution runner resolves — no dev force endpoints.
 */
export const happyPath: Scenario = {
  name: "happy-path",
  run: async ({ step }) => {
    const market = await step("create market on-chain", () =>
      createLifecycleMarket({
        // Unique suffix keeps the metadata hash distinct across suite runs
        // against a long-lived local database.
        question: `Will the lifecycle happy-path market settle YES? (run ${Date.now()})`,
        heuristicOutcome: "yes",
        // The whole pregrad phase (index → approve → trade → startGraduation)
        // must land inside the graduation window, and the scenario's real-time
        // cost is roughly resolutionSeconds: the resolution runner's job
        // eligibility compares resolutionTime against wall clock, which
        // cannot be jumped. 240s gives the pregrad phase ~3x headroom over
        // its typical ~70s while keeping the wall wait to a few minutes.
        graduationSeconds: 240,
        resolutionSeconds: 300,
      }),
    );

    // Pre-graduation step timeouts must sum below graduationSeconds (240s)
    // so a slow stack fails at the slow step with a clear message instead of
    // silently crossing the graduation deadline and reporting a confusing
    // refunded market: 45s indexing + 90s review + 30s receipt indexing
    // leaves ≥75s for the keeper's pass to start graduation.
    await step("indexer serves the market as under_review", async () => {
      const indexed = await waitForApiStatus(market.marketId, "under_review", {
        timeoutMs: 45_000,
      });
      assertEqual(
        "indexed metadata hash",
        indexed.metadataHash.toLowerCase(),
        market.metadataHash.toLowerCase(),
      );
    });

    await step("review runner approves via heuristic provider", async () => {
      await waitForApiStatus(market.marketId, "bootstrap", {
        timeoutMs: 90_000,
      });

      const [review] = await db
        .select()
        .from(schema.marketAiReviews)
        .where(
          and(
            eq(schema.marketAiReviews.chainId, config.chainId),
            eq(schema.marketAiReviews.marketId, market.marketId),
          ),
        )
        .limit(1);
      assertEqual("review verdict", review?.verdict, "approve");

      await assertChainStatus(
        "on-chain status after approval",
        market.marketId,
        MARKET_STATUS.active,
      );
    });

    const trading = await step("traders place matched receipt volume", () =>
      placeGraduationLiquidity({
        marketId: market.marketId,
        thresholdWad: market.graduationThresholdWad,
        yesTraderAccountIndex: SCENARIO_ACCOUNTS.happyPathYes,
        noTraderAccountIndex: SCENARIO_ACCOUNTS.happyPathNo,
      }),
    );

    await step("receipts reach the indexed paper trail", () =>
      waitForIndexedRows(
        `all ${trading.receiptCount} receipts indexed`,
        schema.receiptPlacedEvents,
        market.marketId,
        trading.receiptCount,
      ),
    );

    const graduated = await step(
      "keeper graduates the market (clearing, finalize, claims)",
      async () => {
        const current = await waitForApiStatus(market.marketId, "graduated", {
          requirePostgrad: true,
          timeoutMs: 240_000,
        });

        const claims = await db
          .select()
          .from(schema.graduatedReceiptClaimedEvents)
          .where(
            and(
              eq(schema.graduatedReceiptClaimedEvents.chainId, config.chainId),
              eq(
                schema.graduatedReceiptClaimedEvents.marketId,
                market.marketId,
              ),
            ),
          );
        assertEqual(
          "every receipt claimed at graduation",
          claims.length,
          trading.receiptCount,
        );

        return current;
      },
    );

    const postgradMarketAddress = graduated.postgrad?.marketAddress as Address;

    await step("postgrad venue trade (complete-set round trip)", async () => {
      const manifest = await buildGraduatedMarketManifest({
        collateral: collateralAddress,
        postgradMarket: postgradMarketAddress,
      });
      const trader = walletFor(SCENARIO_ACCOUNTS.happyPathPostgradTrader);

      await executeCompleteSetArb({
        account: trader.account.address,
        action: "mintAndSell",
        arbCollateral: parseUnits("25", manifest.collateral.decimals),
        chainId: config.chainId,
        collateralLabel: "lifecycle-nightly happy-path trade",
        manifest,
        publicClient: publicClient as PublicClient,
        swapRouter: config.contracts.swapRouter,
        walletClient: createVenueContractWriter(trader),
      });
    });

    await step("resolution runner resolves YES after the gate", async () => {
      await jumpChainTimeTo(market.resolutionTime + 1n);

      const resolved = await waitForApiStatus(market.marketId, "resolved", {
        // Derived, not hardcoded: the runner's eligibility clock is wall
        // time against the chain-anchored gate, so the bound is computed
        // from the gate itself and stays correct regardless of suite order.
        timeoutMs: resolutionRunnerTimeoutMs(market.resolutionTime),
      });
      assertResolution(resolved);

      const [verdict] = await db
        .select()
        .from(schema.marketResolutions)
        .where(
          and(
            eq(schema.marketResolutions.chainId, config.chainId),
            eq(schema.marketResolutions.marketId, market.marketId),
          ),
        )
        .limit(1);
      assertEqual("resolution outcome", verdict?.outcome, "yes");
      assertEqual("resolution provider", verdict?.provider, "heuristic");
    });

    await step("winner redeems YES tokens for collateral", async () => {
      const yesHolder = walletFor(SCENARIO_ACCOUNTS.happyPathYes);
      const yesToken = (await publicClient.readContract({
        abi: completeSetBinaryMarketAbi,
        address: postgradMarketAddress,
        functionName: "yesToken",
      })) as Address;

      const balance = await publicClient.readContract({
        abi: outcomeTokenAbi,
        address: yesToken,
        functionName: "balanceOf",
        args: [yesHolder.account.address],
      });
      if (balance === 0n) {
        throw new Error(
          "YES trader holds no outcome tokens after graduation claims.",
        );
      }

      const approveHash = await yesHolder.writeContract({
        abi: outcomeTokenAbi,
        address: yesToken,
        functionName: "approve",
        args: [postgradMarketAddress, balance],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      const collateralBefore = await publicClient.readContract({
        abi: outcomeTokenAbi,
        address: collateralAddress,
        functionName: "balanceOf",
        args: [yesHolder.account.address],
      });
      const redeemHash = await yesHolder.writeContract({
        abi: completeSetBinaryMarketAbi,
        address: postgradMarketAddress,
        functionName: "redeem",
        args: [SIDE_YES, balance],
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: redeemHash,
      });
      if (receipt.status !== "success") {
        throw new Error(`redeem reverted: ${redeemHash}`);
      }

      const collateralAfter = await publicClient.readContract({
        abi: outcomeTokenAbi,
        address: collateralAddress,
        functionName: "balanceOf",
        args: [yesHolder.account.address],
      });
      // Local collateral is 18-decimal, so the winning side redeems 1:1.
      assertEqual(
        "redeemed collateral equals burned winning tokens",
        collateralAfter - collateralBefore,
        balance,
      );

      await waitForIndexedRows(
        "redemption reaches the indexed paper trail",
        schema.postgradRedemptionEvents,
        market.marketId,
        1,
      );
    });

    await step("money paper trail balances end to end", () =>
      assertMarketPaperTrail({
        createdBlock: market.createdBlock,
        marketId: market.marketId,
        postgradMarketAddress,
      }),
    );

    await step("chain clock sanity", async () => {
      // Guard the sequential-scenario contract: this scenario must leave the
      // chain clock at or past the resolution gate it jumped to, and never
      // behind it (a regression here would corrupt later scenarios' timing).
      const now = await chainNowSeconds();
      if (now <= market.resolutionTime) {
        throw new Error(
          `chain clock ${now} did not advance past resolutionTime ${market.resolutionTime}`,
        );
      }
    });
  },
};

function assertResolution(market: ApiMarket): void {
  if (
    !market.resolution ||
    market.resolution.kind !== "resolved" ||
    market.resolution.winningSide !== "yes"
  ) {
    throw new Error(
      `API resolution payload is not a YES resolution: ${JSON.stringify(market.resolution)}`,
    );
  }
}
