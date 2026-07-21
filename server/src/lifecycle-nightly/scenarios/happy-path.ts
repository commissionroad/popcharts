import {
  completeSetBinaryMarketAbi,
  executeCompleteSetArb,
  outcomeTokenAbi,
  pregradManagerAbi,
  SIDE_YES,
} from "@popcharts/protocol";
import { parseUnits, type Address, type PublicClient } from "viem";

import {
  buildGraduatedMarketManifest,
  createVenueContractWriter,
} from "src/api/services/postgrad-venue";
import { config } from "src/config";
import { and, db, eq, schema } from "src/db/client";

import { assertEqual, CHAIN_STATUS } from "../asserts";
import { chainNowSeconds, jumpChainTimeTo } from "../chain-time";
import { createLifecycleMarket } from "../market-factory";
import { assertMarketPaperTrail } from "../paper-trail";
import {
  FIRST_TRADER_ACCOUNT_INDEX,
  collateralAddress,
  fetchApiMarket,
  pregradManagerAddress,
  publicClient,
  walletFor,
  type ApiMarket,
} from "../stack";
import { placeGraduationLiquidity } from "../pregrad-trading";
import { waitForCondition } from "../wait";
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
      const indexed = await waitForCondition(
        `market ${market.marketId} indexed`,
        () => fetchApiMarket(market.marketId),
        { tickChain: true, timeoutMs: 45_000 },
      );
      assertEqual("indexed status", indexed.status, "under_review");
      assertEqual(
        "indexed metadata hash",
        indexed.metadataHash.toLowerCase(),
        market.metadataHash.toLowerCase(),
      );
    });

    await step("review runner approves via heuristic provider", async () => {
      const approved = await waitForCondition(
        `market ${market.marketId} approved`,
        async () => {
          const current = await fetchApiMarket(market.marketId);
          return current?.status === "bootstrap" ? current : null;
        },
        { tickChain: true, timeoutMs: 90_000 },
      );
      assertEqual("post-review status", approved.status, "bootstrap");

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

      const state = await publicClient.readContract({
        abi: pregradManagerAbi,
        address: pregradManagerAddress,
        functionName: "getMarketState",
        args: [market.marketId],
      });
      assertEqual(
        "on-chain status after approval",
        Number(state.status),
        CHAIN_STATUS.active,
      );
    });

    const trading = await step("traders place matched receipt volume", () =>
      placeGraduationLiquidity({
        marketId: market.marketId,
        thresholdWad: market.graduationThresholdWad,
        yesTraderAccountIndex: FIRST_TRADER_ACCOUNT_INDEX,
        noTraderAccountIndex: FIRST_TRADER_ACCOUNT_INDEX + 1,
      }),
    );

    await step("receipts reach the indexed paper trail", async () => {
      await waitForCondition(
        `all ${trading.receiptCount} receipts indexed`,
        async () => {
          const rows = await db
            .select()
            .from(schema.receiptPlacedEvents)
            .where(
              and(
                eq(schema.receiptPlacedEvents.chainId, config.chainId),
                eq(schema.receiptPlacedEvents.marketId, market.marketId),
              ),
            );
          return rows.length >= trading.receiptCount ? rows : null;
        },
        { tickChain: true, timeoutMs: 30_000 },
      );
    });

    const graduated = await step(
      "keeper graduates the market (clearing, finalize, claims)",
      async () => {
        const current = await waitForCondition(
          `market ${market.marketId} graduated`,
          async () => {
            const api = await fetchApiMarket(market.marketId);
            return api?.status === "graduated" && api.postgrad?.marketAddress
              ? api
              : null;
          },
          { tickChain: true, timeoutMs: 240_000 },
        );

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
      const trader = walletFor(FIRST_TRADER_ACCOUNT_INDEX + 2);

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

      const resolved = await waitForCondition(
        `market ${market.marketId} resolved`,
        async () => {
          const api = await fetchApiMarket(market.marketId);
          return api?.status === "resolved" ? api : null;
        },
        // Upper bound: resolutionSeconds of wall-clock eligibility wait plus
        // the runner's poll/lease cycle. Run 2 of the suite passed this step
        // with under 4s to spare at 300s, so the bound carries real margin.
        { tickChain: true, timeoutMs: 420_000 },
      );
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
      const yesHolder = walletFor(FIRST_TRADER_ACCOUNT_INDEX);
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

      await waitForCondition(
        "redemption reaches the indexed paper trail",
        async () => {
          const rows = await db
            .select()
            .from(schema.postgradRedemptionEvents)
            .where(
              and(
                eq(schema.postgradRedemptionEvents.chainId, config.chainId),
                eq(schema.postgradRedemptionEvents.marketId, market.marketId),
              ),
            );
          return rows.length > 0 ? rows : null;
        },
        { tickChain: true },
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
