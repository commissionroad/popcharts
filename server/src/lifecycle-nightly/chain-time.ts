import { waitForChainTimestamp } from "src/api/services/local-dev-chain";

import { publicClient } from "./stack";

/**
 * Chain-time control for lifecycle scenarios. The suite reaches a time gate by
 * waiting for it in real time and never by warping the chain clock, which is
 * what collapses the two clocks the lifecycle used to straddle: on-chain gates
 * (graduation deadline, resolution time, dispute window) read block
 * timestamps, while the AI runners' job eligibility compares market timestamps
 * against wall-clock `new Date()`. A warp moved only the first of those, left
 * a permanent offset behind it, and made every later scenario wait that offset
 * out on top of its own window (ADR 0028 G5). Waiting moves neither clock
 * relative to the other, so scenarios can pick a window and pay exactly that.
 *
 * The cost is real seconds, which is why every scenario configures its own
 * windows in the tens to low hundreds of seconds rather than the production
 * defaults.
 */

/**
 * Upper bound on a single gate wait. Deliberately wider than the widest window
 * any scenario configures (partial clearing's 600s graduation window is never
 * waited on; the waits are the 240s graduation deadlines and the 60s dispute
 * windows), so it only ever trips on a chain that has stopped producing
 * blocks — which then fails loudly here instead of parking the suite until its
 * own hard deadline.
 */
const SCENARIO_GATE_WAIT_LIMIT_MS = 300_000;

export async function chainNowSeconds(): Promise<bigint> {
  const block = await publicClient.getBlock();
  return block.timestamp;
}

/**
 * Waits until the chain clock passes `targetSeconds`. Used for the gates that
 * have no wall-clock counterpart to wait on — a graduation deadline the keeper
 * must observe as past, a dispute window that has to close — where the
 * scenario would otherwise have nothing to poll.
 */
export async function waitForChainTime(targetSeconds: bigint): Promise<void> {
  await waitForChainTimestamp(publicClient, targetSeconds, {
    label: `chain time ${targetSeconds}`,
    waitLimitMs: SCENARIO_GATE_WAIT_LIMIT_MS,
  });
}

/**
 * Post-verdict slack on top of the eligibility wait: the runner's poll/lease
 * cycle, the heuristic service call, an optional chain transition, and the
 * indexer flip all happen after the gate opens.
 */
const RESOLUTION_RUNNER_MARGIN_MS = 120_000;

/**
 * Wall-clock bound for "the resolution runner acts on this market": its
 * eligibility clock is `new Date()` against the market's (chain-anchored)
 * resolution gate, so the bound is the time still left until that gate plus a
 * fixed runner margin. With nothing in the suite warping the chain any more,
 * chain time and wall time stay together, so this is simply "how long the
 * window has left" — it no longer has to absorb an accumulated chain-vs-wall
 * offset, and scenario order no longer changes what it returns.
 */
export function resolutionRunnerTimeoutMs(resolutionTime: bigint): number {
  const untilEligibleMs = Number(resolutionTime) * 1000 - Date.now();
  return Math.max(untilEligibleMs, 0) + RESOLUTION_RUNNER_MARGIN_MS;
}
