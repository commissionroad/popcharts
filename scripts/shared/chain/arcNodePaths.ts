import path from "node:path";

import { assertValidSlot } from "../localStack/assertValidSlot.ts";
import { repoRoot } from "../paths.ts";

/**
 * Where a single arc-node instance keeps the state it owns on disk.
 *
 * The datadir is a bound resource, not merely a location: arc-node opens an
 * MDBX database and holds an **exclusive lock** on it for the process's whole
 * life. Two instances pointed at one datadir do not interleave — the second
 * refuses to start. So the datadir strides per slot exactly like a port does,
 * which is why `deriveStackResources` publishes it alongside them
 * (ADR 0028 G7).
 *
 * Everything lands under the repository's ignored `.local-dev/` tree because
 * arc-node's own defaults do not: it writes tracing output to `~/.cache/reth`
 * unless `--log.file.directory` says otherwise, and AGENTS.md forbids writing
 * outside the repository without approval (ADR 0028 G9). The log directory is
 * therefore part of this layout even though nothing contends for it.
 *
 * Keyed by slot rather than by port. Both were available — the port is derived
 * from the slot, so either name is unique — but the slot is the identity every
 * other per-stack resource announces (`.env.local-chain.1`, `popcharts_1`), and
 * a directory named after a port invites the reading that the port is the thing
 * that owns the chain. `.local-dev/` is per-worktree, so slot numbers only ever
 * collide with the same worktree's other slots, which is precisely what the
 * stride prevents.
 */

/** Root holding every slot's Arc chain state in this worktree. */
export function arcChainRoot(): string {
  return path.join(repoRoot, ".local-dev", "arc-chain");
}

/** Directory holding everything the chain on `slot` owns. */
export function arcChainInstanceDir(slot: number): string {
  assertValidSlot(slot);
  return path.join(arcChainRoot(), `slot-${slot}`);
}

/** MDBX datadir for the chain on `slot`. Exclusively locked while it runs. */
export function arcChainDataDir(slot: number): string {
  return path.join(arcChainInstanceDir(slot), "data");
}

/** Tracing log directory for the chain on `slot`. See ADR 0028 G9. */
export function arcChainLogDir(slot: number): string {
  return path.join(arcChainInstanceDir(slot), "logs");
}
