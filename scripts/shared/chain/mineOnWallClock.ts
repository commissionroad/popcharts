import { postJsonRpc } from "./postJsonRpc.ts";

/**
 * How often the Hardhat devchain mines an empty block once this is enabled.
 * One second is the resolution of a block timestamp, so a shorter interval
 * would only add empty blocks without making the clock any more precise.
 */
export const WALL_CLOCK_BLOCK_INTERVAL_MS = 1_000;

/** JSON-RPC "method not found": the node has no `evm_*` namespace. */
const METHOD_NOT_FOUND = -32601;

/**
 * Makes a Hardhat devchain mine on a timer as well as on every transaction,
 * so its block clock follows wall-clock time while it sits idle.
 *
 * `hardhat node` automines by default: a block exists only when a transaction
 * lands, so an idle chain's latest timestamp stays frozen at its last trade.
 * A caller that waits for a chain-time gate by polling block timestamps —
 * the lifecycle scenarios since ADR 0028 Phase 4 — then waits forever, because
 * nothing will ever mine the block that crosses the gate. The Arc local chain
 * mines every 200ms on its own (ADR 0028 G5); interval mining gives the
 * Hardhat devchain the same property until Phase 5 retires it. Automine stays
 * on, so transactions are still mined the moment they are sent.
 *
 * A chain that answers "method not found" is left alone: it has no `evm_*`
 * namespace (ADR 0028 G1), which is the Arc chain, and that one already mines
 * on its own clock.
 */
export async function mineOnWallClock(rpcUrl: string): Promise<void> {
  const response = await postJsonRpc({
    method: "evm_setIntervalMining",
    params: [WALL_CLOCK_BLOCK_INTERVAL_MS],
    rpcUrl,
  });

  if (!response.error || isMethodNotFound(response.error)) {
    return;
  }

  throw new Error(
    `RPC evm_setIntervalMining failed on ${rpcUrl}: ${response.error.message}`,
  );
}

function isMethodNotFound(error: { code?: number; message: string }): boolean {
  return (
    error.code === METHOD_NOT_FOUND || /method not found/i.test(error.message)
  );
}
