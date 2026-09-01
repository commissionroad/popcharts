import type { BlockchainClient } from "src/blockchain/client";
import { config } from "src/config";
import { DEFAULT_HARDHAT_PRIVATE_KEY } from "src/shared/local-dev-accounts";

/**
 * Shared plumbing for dev-only services that drive the local chain: the dev
 * signing key, raw local RPC calls, and reaching a chain-time gate. Nothing
 * here is safe for live networks; callers must gate on dev tools being enabled
 * for the local network.
 */

/** Resolves the dev signing key, defaulting to the first Hardhat account. */
export function readDevPrivateKey(): `0x${string}` {
  const value =
    process.env.POPCHARTS_DEVCHAIN_PRIVATE_KEY ??
    process.env.POPCHARTS_DEPLOYER_PRIVATE_KEY ??
    DEFAULT_HARDHAT_PRIVATE_KEY;

  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(
      "POPCHARTS_DEVCHAIN_PRIVATE_KEY must be a 32-byte hex key.",
    );
  }

  return value as `0x${string}`;
}

/**
 * Longest a dev flow will sit on the wall clock waiting for a chain-time gate
 * to open on a chain that cannot warp (ADR 0028 G4). Sized for local windows
 * configured in the tens of seconds — `LOCAL_MARKET_GRADUATION_SECONDS`,
 * `LOCAL_MARKET_RESOLUTION_SECONDS`, `POPCHARTS_DISPUTE_WINDOW_SECONDS` — with
 * roughly 3x headroom over a 30s window. A gate further out than this is
 * refused up front rather than waited on: a market created with the
 * seven-day production defaults is a misconfiguration the caller has to fix,
 * not something an HTTP request can outlast.
 */
export const CHAIN_GATE_WAIT_LIMIT_MS = 90_000;

/**
 * Extra wall-clock slack on top of the gate's own distance before the wait is
 * declared failed. Covers poll spacing and RPC latency; a chain that has
 * genuinely stopped producing blocks trips it and reports that, rather than
 * parking the caller for the full limit.
 */
const CHAIN_GATE_GRACE_MS = 15_000;

/** How often the wait re-reads the chain clock. */
const CHAIN_GATE_POLL_INTERVAL_MS = 500;

/** How the chain clock came to satisfy a gate, for logging and tests. */
export type ChainGateOutcome = "already_passed" | "warped" | "waited";

/** Injection seams; every one defaults to the real thing. */
export type ChainGateDependencies = {
  now?: () => number;
  requestRpc?: (method: string, params: unknown[]) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Ensures the chain clock has reached `targetTimestamp` before the caller
 * sends the transaction the gate guards.
 *
 * Two chains are supported and they reach a gate differently, so this is
 * deliberately one function with a fallback rather than two call paths:
 *
 * - The Hardhat devchain warps. `evm_setNextBlockTimestamp` schedules the
 *   jump and the caller's next transaction mines it, exactly as before.
 * - The Arc local chain has no `evm_*` namespace at all and never will
 *   (ADR 0028 G1: it is stock reth, a production node client). There the only
 *   way past a gate is to wait for it in real time — which is cheap, because
 *   Arc mines every 200ms and its block clock IS wall clock (G5).
 *
 * The warp attempt is the probe: a node without the method answers
 * `-32601 Method not found`, which costs one round trip per gate and needs no
 * cached capability flag that a restarted chain could invalidate.
 *
 * **Phase 5 removes the warp branch** along with the Hardhat devchain; what is
 * left is `waitForChainTimestamp` on its own.
 */
export async function reachChainTimestamp(
  publicClient: BlockchainClient,
  targetTimestamp: bigint,
  {
    label,
    waitLimitMs = CHAIN_GATE_WAIT_LIMIT_MS,
    ...dependencies
  }: { label: string; waitLimitMs?: number } & ChainGateDependencies,
): Promise<ChainGateOutcome> {
  const requestRpc = dependencies.requestRpc ?? requestLocalRpc;

  if (await chainTimeHasReached(publicClient, targetTimestamp)) {
    return "already_passed";
  }

  if (await tryWarpTo(publicClient, targetTimestamp, requestRpc)) {
    return "warped";
  }

  await waitForChainTimestamp(publicClient, targetTimestamp, {
    label,
    waitLimitMs,
    ...dependencies,
  });

  return "waited";
}

/**
 * Waits until the chain's own clock passes `targetTimestamp`. Polls block
 * timestamps rather than the wall clock on purpose: the block timestamp is
 * the value the contract's gate compares against, so waiting on anything else
 * would be waiting on a proxy for it.
 *
 * Bounded twice, and the two bounds report different faults: a gate further
 * away than `waitLimitMs` is refused before the first sleep (the windows are
 * misconfigured — nothing about waiting will fix it), while a gate inside the
 * limit that still has not opened by its own distance plus a grace period
 * means the chain has stopped advancing.
 */
export async function waitForChainTimestamp(
  publicClient: BlockchainClient,
  targetTimestamp: bigint,
  {
    label,
    now = Date.now,
    sleep = defaultSleep,
    waitLimitMs = CHAIN_GATE_WAIT_LIMIT_MS,
  }: { label: string; waitLimitMs?: number } & ChainGateDependencies,
): Promise<void> {
  let chainNow = (await publicClient.getBlock()).timestamp;

  if (chainNow >= targetTimestamp) {
    return;
  }

  const secondsAway = Number(targetTimestamp - chainNow);

  if (secondsAway * 1000 > waitLimitMs) {
    throw new Error(
      `Refusing to wait ${secondsAway}s for ${label}: the chain clock is at ` +
        `${chainNow} and the gate opens at ${targetTimestamp}, beyond the ` +
        `${waitLimitMs}ms limit. This chain cannot warp time (ADR 0028 G1), ` +
        "so local windows must be configured in the tens of seconds — see " +
        "LOCAL_MARKET_GRADUATION_SECONDS, LOCAL_MARKET_RESOLUTION_SECONDS " +
        "and POPCHARTS_DISPUTE_WINDOW_SECONDS.",
    );
  }

  const startedAt = now();
  const deadline = startedAt + secondsAway * 1000 + CHAIN_GATE_GRACE_MS;

  while (chainNow < targetTimestamp) {
    if (now() >= deadline) {
      throw new Error(
        `Timed out after ${now() - startedAt}ms waiting for ${label}: the ` +
          `chain clock is at ${chainNow} and the gate opens at ` +
          `${targetTimestamp}. The chain is not producing blocks fast enough ` +
          "to close a gap it should have closed in real time.",
      );
    }

    await sleep(CHAIN_GATE_POLL_INTERVAL_MS);
    chainNow = (await publicClient.getBlock()).timestamp;
  }
}

/**
 * Schedules the next block's timestamp, returning false when the chain has no
 * `evm_*` namespace to schedule it with. A warp that fails for any other
 * reason is re-checked against the chain clock before it propagates: a block
 * landing between the read above and this call moves the gate into the past,
 * and the devchain then rejects the warp as backwards — a race that means the
 * gate is open, not that the caller failed.
 */
async function tryWarpTo(
  publicClient: BlockchainClient,
  targetTimestamp: bigint,
  requestRpc: (method: string, params: unknown[]) => Promise<void>,
): Promise<boolean> {
  try {
    await requestRpc("evm_setNextBlockTimestamp", [Number(targetTimestamp)]);
    return true;
  } catch (error) {
    if (isMethodNotFound(error)) {
      return false;
    }

    if (await chainTimeHasReached(publicClient, targetTimestamp)) {
      return true;
    }

    throw error;
  }
}

async function chainTimeHasReached(
  publicClient: BlockchainClient,
  targetTimestamp: bigint,
): Promise<boolean> {
  const latestBlock = await publicClient.getBlock();

  return latestBlock.timestamp >= targetTimestamp;
}

/**
 * A JSON-RPC error the local chain answered with. The code is carried because
 * `-32601` is the whole signal that a node is a production client without the
 * testing namespaces, and a message string alone cannot be matched on safely.
 */
export class LocalRpcError extends Error {
  readonly code: number | undefined;

  constructor(message: string, code?: number) {
    super(message);
    this.name = "LocalRpcError";
    this.code = code;
  }
}

/**
 * Both halves of "this node does not implement that method": the JSON-RPC
 * code, and the message, since an intermediary can rewrite the envelope while
 * preserving the text.
 */
function isMethodNotFound(error: unknown): boolean {
  if (error instanceof LocalRpcError && error.code === -32601) {
    return true;
  }

  return error instanceof Error && /method not found/i.test(error.message);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends a raw JSON-RPC request to the configured local chain. Module-private:
 * the only caller left is the warp probe above, and a general "call anything on
 * the devchain" seam is what let `evm_*` dependencies spread in the first place.
 */
async function requestLocalRpc(method: string, params: unknown[]) {
  const response = await fetch(config.rpcHttpUrl, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method,
      params,
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
  const body = (await response.json()) as {
    error?: {
      code?: number;
      message?: string;
    };
  };

  if (!response.ok || body.error) {
    throw new LocalRpcError(
      body.error?.message ?? `${method} failed with HTTP ${response.status}`,
      body.error?.code,
    );
  }
}

/** Reads the latest local block timestamp as a Date. */
export async function getLatestBlockTimestamp(publicClient: BlockchainClient) {
  const block = await publicClient.getBlock();

  return new Date(Number(block.timestamp) * 1000);
}
