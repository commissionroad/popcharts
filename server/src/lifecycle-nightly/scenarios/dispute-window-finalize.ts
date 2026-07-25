import {
  completeSetBinaryMarketAbi,
  POSTGRAD_MARKET_STATUS,
  SIDE_YES,
} from "@popcharts/protocol";
import type { Address } from "viem";

import { config } from "src/config";
import { and, db, eq, schema } from "src/db/client";

import { assertEqual, assertTruthy } from "../asserts";
import {
  chainNowSeconds,
  jumpChainTimeTo,
  resolutionRunnerTimeoutMs,
} from "../chain-time";
import { createLifecycleMarket } from "../market-factory";
import { waitForApiStatus, waitForIndexedRows } from "../market-checks";
import { setPostgradDisputeConfig } from "../operator";
import { SCENARIO_ACCOUNTS, fetchApiMarket, publicClient } from "../stack";
import { placeGraduationLiquidity } from "../pregrad-trading";
import type { Scenario } from "../report";

/**
 * ADR 0024 optimistic resolution, undisputed path: the resolution runner
 * *proposes* YES instead of resolving it, the market parks in
 * `resolution_pending` for the whole dispute window, and the keeper's
 * finalize duty settles it the moment the window closes — with nobody having
 * disputed and no operator involved.
 *
 * The window is chain time, so the scenario never waits it out: it asserts the
 * market stays pending while the window is open, then jumps the chain clock to
 * the deadline and lets the keeper act. Sixty seconds is deliberately short —
 * the jump's offset is permanent for the rest of the suite — but far longer
 * than the ~1s-per-10s of chain drift the harness's tick mining adds, so the
 * window cannot close underneath the assertions.
 */
const DISPUTE_WINDOW_SECONDS = 60n;

export const disputeWindowFinalize: Scenario = {
  name: "dispute-window-finalize",
  run: async ({ step }) => {
    // Local stacks deploy the adapter with a zero window, which degenerates to
    // the single-step resolve path. Retune the adapter rather than the local
    // default: the values are stamped into each market at graduation, so this
    // market keeps its window once the default is handed back.
    const previousDisputeConfig = await step(
      "configure a real dispute window on the adapter",
      () =>
        setPostgradDisputeConfig({
          disputeBond: 0n,
          disputeWindow: DISPUTE_WINDOW_SECONDS,
        }),
    );

    let postgradMarketAddress: Address;
    let market: Awaited<ReturnType<typeof createLifecycleMarket>>;

    try {
      market = await step("create market with a YES marker", () =>
        createLifecycleMarket({
          question: `Will the undisputed proposal finalize itself? (run ${Date.now()})`,
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
          yesTraderAccountIndex: SCENARIO_ACCOUNTS.disputeFinalizeYes,
          noTraderAccountIndex: SCENARIO_ACCOUNTS.disputeFinalizeNo,
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
      // this market has its own copy — nothing else should graduate with a
      // window it did not ask for, including when a step above failed.
      await setPostgradDisputeConfig(previousDisputeConfig);
    }

    await step(
      "the graduated market carries the configured window",
      async () => {
        // Without this the scenario would still pass with a zero window, proving
        // nothing: a zero window makes a proposal finalizable immediately.
        const stamped = await publicClient.readContract({
          abi: completeSetBinaryMarketAbi,
          address: postgradMarketAddress,
          functionName: "disputeWindow",
        });
        assertEqual("stamped dispute window", stamped, DISPUTE_WINDOW_SECONDS);
      },
    );

    const disputeDeadline = await step(
      "resolution runner proposes YES instead of resolving",
      async () => {
        await jumpChainTimeTo(market.resolutionTime + 1n);

        const pending = await waitForApiStatus(
          market.marketId,
          "resolution_pending",
          // Derived, not hardcoded: the runner's eligibility clock is wall time
          // against the chain-anchored gate, so the bound is computed from the
          // gate itself and stays correct regardless of suite order.
          { timeoutMs: resolutionRunnerTimeoutMs(market.resolutionTime) },
        );
        assertEqual(
          "API status while the window is open",
          pending.status,
          "resolution_pending",
        );

        const [status, proposedSide, deadline] = await Promise.all([
          publicClient.readContract({
            abi: completeSetBinaryMarketAbi,
            address: postgradMarketAddress,
            functionName: "status",
          }),
          publicClient.readContract({
            abi: completeSetBinaryMarketAbi,
            address: postgradMarketAddress,
            functionName: "proposedSide",
          }),
          publicClient.readContract({
            abi: completeSetBinaryMarketAbi,
            address: postgradMarketAddress,
            functionName: "disputeDeadline",
          }),
        ]);
        assertEqual(
          "contract status after the proposal",
          Number(status),
          POSTGRAD_MARKET_STATUS.resolutionPending,
        );
        assertEqual("proposed side", Number(proposedSide), SIDE_YES);

        // The runner's audit row is written whether or not the market settles;
        // the on-chain proposal is what the dispute window guards.
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

        const [proposal] = await waitForIndexedRows(
          "proposal reaches the indexed dispute trail",
          schema.postgradDisputeEvents,
          market.marketId,
          1,
        );
        assertEqual("indexed dispute kind", proposal?.kind, "proposed");
        assertEqual("indexed proposed side", proposal?.proposedSide, "yes");

        return deadline;
      },
    );

    await step("nobody finalizes while the window is open", async () => {
      // The keeper sweeps every 30s and cannot finalize early — the contract
      // reverts DisputeWindowStillOpen — so this asserts the guard end to end.
      const chainNow = await chainNowSeconds();
      if (chainNow >= disputeDeadline) {
        throw new Error(
          `dispute window closed before the assertion (chain ${chainNow} >= deadline ${disputeDeadline}); widen DISPUTE_WINDOW_SECONDS`,
        );
      }
      const still = assertTruthy(
        "market payload while the window is open",
        await fetchApiMarket(market.marketId),
      );
      assertEqual("status stays pending", still.status, "resolution_pending");
    });

    await step("keeper finalizes once the window closes", async () => {
      await jumpChainTimeTo(disputeDeadline);

      // One keeper sweep interval (30s) plus the indexer flip, with slack.
      const resolved = await waitForApiStatus(market.marketId, "resolved", {
        timeoutMs: 120_000,
      });
      if (
        !resolved.resolution ||
        resolved.resolution.kind !== "resolved" ||
        resolved.resolution.winningSide !== "yes"
      ) {
        throw new Error(
          `API resolution payload is not a YES resolution: ${JSON.stringify(resolved.resolution)}`,
        );
      }

      const status = await publicClient.readContract({
        abi: completeSetBinaryMarketAbi,
        address: postgradMarketAddress,
        functionName: "status",
      });
      assertEqual(
        "contract status after finalization",
        Number(status),
        POSTGRAD_MARKET_STATUS.resolved,
      );
    });
  },
};
