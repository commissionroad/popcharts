import {
  completeSetBinaryMarketAbi,
  outcomeTokenAbi,
} from "@popcharts/protocol";
import type { Address } from "viem";

import { config } from "src/config";
import { and, db, eq, schema } from "src/db/client";

import { assertEqual, assertTruthy } from "../asserts";
import { jumpChainTimeTo } from "../chain-time";
import { createLifecycleMarket } from "../market-factory";
import { cancelPostgradMarketAsResolver } from "../operator";
import { assertMarketPaperTrail } from "../paper-trail";
import {
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
const TRADER = 12;

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
      await waitForCondition(
        `market ${market.marketId} approved`,
        async () => {
          const current = await fetchApiMarket(market.marketId);
          return current?.status === "bootstrap" ? current : null;
        },
        { tickChain: true, timeoutMs: 90_000 },
      );
    });

    await step("one trader supplies both sides to threshold", () =>
      placeGraduationLiquidity({
        marketId: market.marketId,
        thresholdWad: market.graduationThresholdWad,
        yesTraderAccountIndex: TRADER,
        noTraderAccountIndex: TRADER,
      }),
    );

    const graduated = await step("keeper graduates the market", async () =>
      waitForCondition(
        `market ${market.marketId} graduated`,
        async () => {
          const api = await fetchApiMarket(market.marketId);
          return api?.status === "graduated" && api.postgrad?.marketAddress
            ? api
            : null;
        },
        { tickChain: true, timeoutMs: 240_000 },
      ),
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
        // The runner's eligibility clock is wall time, so this waits out
        // the market's resolution window in real time — PLUS the permanent
        // chain-vs-wall offset left by every earlier jump (hardhat keeps
        // jump offsets forever), because this market's resolutionTime was
        // anchored to the already-ahead chain clock. With the happy path
        // ahead of us that is ~300s of offset + the 300s window + runner
        // overhead ≈ 620s; 780s leaves real margin.
        { tickChain: true, timeoutMs: 780_000 },
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

      const cancelled = await waitForCondition(
        `market ${market.marketId} cancelled`,
        async () => {
          const api = await fetchApiMarket(market.marketId);
          return api?.status === "cancelled" ? api : null;
        },
        { tickChain: true, timeoutMs: 60_000 },
      );
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

      await waitForCondition(
        "cancelled redemption reaches the indexed paper trail",
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
        { tickChain: true, timeoutMs: 30_000 },
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
