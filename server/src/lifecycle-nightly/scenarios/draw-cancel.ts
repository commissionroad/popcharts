import {
  completeSetBinaryMarketAbi,
  outcomeTokenAbi,
} from "@popcharts/protocol";
import type { Address } from "viem";

import { config } from "src/config";
import { and, db, eq, schema } from "src/db/client";

import { assertEqual, assertTruthy } from "../asserts";
import { jumpChainTimeTo, resolutionRunnerTimeoutMs } from "../chain-time";
import { createLifecycleMarket } from "../market-factory";
import { waitForApiStatus, waitForIndexedRows } from "../market-checks";
import { cancelPostgradMarketAsResolver } from "../operator";
import { assertMarketPaperTrail } from "../paper-trail";
import {
  SCENARIO_ACCOUNTS,
  fetchApiMarket,
  collateralAddress,
  publicClient,
  walletFor,
} from "../stack";
import { placeGraduationLiquidity } from "../pregrad-trading";
import { waitForCondition } from "../wait";
import type { Scenario } from "../report";

/**
 * ADR 0014 unhappy path: the draw outcome. The heuristic resolution provider
 * returns `draw`, and the runner deliberately parks it (draws are always a
 * human decision — `cancel_draw` maps to no chain action); the operator then
 * cancels the postgrad market with the resolver key, and the holder redeems
 * both legs at half value through `redeemCancelled`.
 *
 * One trader supplies both sides of the graduation volume so a single
 * account ends up holding YES and NO retained tokens — the verified
 * both-legs redemption path.
 */
const TRADER = SCENARIO_ACCOUNTS.drawCancelHolder;

export const drawCancel: Scenario = {
  name: "draw-cancel",
  run: async ({ step }) => {
    const market = await step("create market with a draw marker", () =>
      createLifecycleMarket({
        question: `Will the finalists tie the lifecycle championship? (run ${Date.now()})`,
        heuristicOutcome: "draw",
        graduationSeconds: 240,
        resolutionSeconds: 300,
      }),
    );

    await step("review runner approves via heuristic provider", async () => {
      // Budget covers creation-tx indexing plus the runner's poll and the
      // approval round-trip — the same pipeline happy-path splits into a
      // 45s indexing wait and a 90s review wait.
      await waitForApiStatus(market.marketId, "bootstrap", {
        timeoutMs: 135_000,
      });
    });

    await step("one trader supplies both sides to threshold", () =>
      placeGraduationLiquidity({
        marketId: market.marketId,
        thresholdWad: market.graduationThresholdWad,
        yesTraderAccountIndex: TRADER,
        noTraderAccountIndex: TRADER,
      }),
    );

    const graduated = await step("keeper graduates the market", () =>
      waitForApiStatus(market.marketId, "graduated", {
        requirePostgrad: true,
        timeoutMs: 240_000,
      }),
    );
    const postgradMarketAddress = graduated.postgrad?.marketAddress as Address;

    await step("resolution runner parks the draw for a human", async () => {
      await jumpChainTimeTo(market.resolutionTime + 1n);

      const verdict = await waitForCondition(
        `market ${market.marketId} draw verdict recorded`,
        async () => {
          const [row] = await db
            .select()
            .from(schema.marketResolutions)
            .where(
              and(
                eq(schema.marketResolutions.chainId, config.chainId),
                eq(schema.marketResolutions.marketId, market.marketId),
              ),
            )
            .limit(1);
          return row ?? null;
        },
        // Derived, not hardcoded: the runner's eligibility clock is wall
        // time against the chain-anchored gate (which carries every prior
        // jump's permanent offset), so the bound is computed from the gate
        // itself and stays correct regardless of suite order. No tick: this
        // probe reads the runner's own DB row — nothing needs the indexer,
        // and every idle mine would add a second of permanent chain offset.
        { timeoutMs: resolutionRunnerTimeoutMs(market.resolutionTime) },
      );
      assertEqual("resolution outcome", verdict.outcome, "draw");
      assertEqual("resolution verdict", verdict.verdict, "cancel_draw");
      assertEqual("resolution provider", verdict.provider, "heuristic");

      // Draws are always a human decision: the runner must have recorded
      // the verdict WITHOUT cancelling the market on-chain.
      const still = assertTruthy(
        "market payload after parked draw",
        await fetchApiMarket(market.marketId),
      );
      assertEqual("status stays graduated", still.status, "graduated");
    });

    await step("operator cancels with the resolver key", async () => {
      await cancelPostgradMarketAsResolver(postgradMarketAddress);

      const cancelled = await waitForApiStatus(market.marketId, "cancelled", {
        timeoutMs: 60_000,
      });
      if (
        !cancelled.resolution ||
        cancelled.resolution.kind !== "cancelled" ||
        (cancelled.resolution.winningSide ?? null) !== null
      ) {
        throw new Error(
          `API resolution payload is not a cancellation: ${JSON.stringify(cancelled.resolution)}`,
        );
      }
    });

    await step("holder redeems both legs at half value", async () => {
      const holder = walletFor(TRADER);
      const [yesToken, noToken] = (await Promise.all([
        publicClient.readContract({
          abi: completeSetBinaryMarketAbi,
          address: postgradMarketAddress,
          functionName: "yesToken",
        }),
        publicClient.readContract({
          abi: completeSetBinaryMarketAbi,
          address: postgradMarketAddress,
          functionName: "noToken",
        }),
      ])) as [Address, Address];

      const [yesBalance, noBalance] = await Promise.all([
        publicClient.readContract({
          abi: outcomeTokenAbi,
          address: yesToken,
          functionName: "balanceOf",
          args: [holder.account.address],
        }),
        publicClient.readContract({
          abi: outcomeTokenAbi,
          address: noToken,
          functionName: "balanceOf",
          args: [holder.account.address],
        }),
      ]);
      if (yesBalance === 0n || noBalance === 0n) {
        throw new Error(
          `holder is missing a leg after graduation claims (yes ${yesBalance}, no ${noBalance})`,
        );
      }

      for (const [token, amount] of [
        [yesToken, yesBalance],
        [noToken, noBalance],
      ] as const) {
        const approveHash = await holder.writeContract({
          abi: outcomeTokenAbi,
          address: token,
          functionName: "approve",
          args: [postgradMarketAddress, amount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      const collateralBefore = await publicClient.readContract({
        abi: outcomeTokenAbi,
        address: collateralAddress,
        functionName: "balanceOf",
        args: [holder.account.address],
      });
      const redeemHash = await holder.writeContract({
        abi: completeSetBinaryMarketAbi,
        address: postgradMarketAddress,
        functionName: "redeemCancelled",
        args: [yesBalance, noBalance],
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: redeemHash,
      });
      if (receipt.status !== "success") {
        throw new Error(`redeemCancelled reverted: ${redeemHash}`);
      }
      const collateralAfter = await publicClient.readContract({
        abi: outcomeTokenAbi,
        address: collateralAddress,
        functionName: "balanceOf",
        args: [holder.account.address],
      });

      // Cancelled markets pay every leg out at half value; on 18-decimal
      // local collateral that is exactly (yes + no) / 2.
      assertEqual(
        "cancelled redemption pays half per leg",
        collateralAfter - collateralBefore,
        (yesBalance + noBalance) / 2n,
      );

      await waitForIndexedRows(
        "cancelled redemption reaches the indexed paper trail",
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
  },
};
