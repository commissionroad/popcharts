import {
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { isRpcReady } from "../net/isRpcReady.ts";
import type { StackKind } from "./identity.ts";

/**
 * The on-disk record of one running local dev stack, written to the registry
 * at startup and read by other stacks (and stack-targeting scripts) to
 * discover what is already running. Carries everything needed to address the
 * stack — its slot, ports, devchain, database, env file — plus the control
 * process id and start time used to decide whether it is still alive (ADR 0020).
 */
export type StackDescriptor = {
  instanceId: string;
  slot: number;
  kind: StackKind;
  worktreePath: string;
  chainPort: number;
  chainId: number;
  apiPort: number;
  appPort: number;
  reviewPort: number;
  resolutionPort: number;
  pcAdminPort: number;
  dbName: string;
  envFilePath: string;
  deployAddressesPath: string | null;
  controlPid: number;
  startedAt: string;
};

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

function descriptorPath(instanceId: string): string {
  return join(registryDir(), `${instanceId}.json`);
}

/**
 * Absolute path to the registry directory shared across all checkouts and
 * worktrees. Defaults to `~/.popcharts/local-stacks/` (home, because each
 * worktree has its own `.local-dev/` and the registry must be cross-worktree);
 * overridable via `POPCHARTS_STACK_REGISTRY_DIR` to keep tests hermetic.
 */
export function registryDir(): string {
  return (
    process.env.POPCHARTS_STACK_REGISTRY_DIR ??
    join(homedir(), ".popcharts", "local-stacks")
  );
}

/**
 * Persists a stack's descriptor to `<registryDir>/<instanceId>.json`, creating
 * the registry directory if needed. Overwrites any existing file for the same
 * instance id, so a restarting stack refreshes its own record.
 */
export function writeDescriptor(descriptor: StackDescriptor): void {
  mkdirSync(registryDir(), { recursive: true });
  writeFileSync(
    descriptorPath(descriptor.instanceId),
    `${JSON.stringify(descriptor, null, 2)}\n`,
  );
}

/**
 * Deletes a stack's descriptor from the registry. A missing file is not an
 * error (another process may have pruned it concurrently); any other failure
 * propagates.
 */
export function removeDescriptor(instanceId: string): void {
  try {
    unlinkSync(descriptorPath(instanceId));
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }
}

/**
 * Reads every stack descriptor currently in the registry. Returns an empty
 * array when the registry directory does not exist yet, and skips any
 * malformed or concurrently-removed file so one bad descriptor never hides the
 * live stacks. Liveness is not checked here — use `pruneDeadDescriptors`.
 */
export function readDescriptors(): StackDescriptor[] {
  let filenames: string[];

  try {
    filenames = readdirSync(registryDir()).filter((name) => name.endsWith(".json"));
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return [];
    }
    throw error;
  }

  const descriptors: StackDescriptor[] = [];
  for (const filename of filenames) {
    try {
      descriptors.push(
        JSON.parse(readFileSync(join(registryDir(), filename), "utf8")) as StackDescriptor,
      );
    } catch {
      // A malformed or concurrently removed descriptor must not hide live stacks.
    }
  }

  return descriptors;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is owned by another user — still
    // alive; only ESRCH (falls through to false) means it is truly gone.
    return errorCode(error) === "EPERM";
  }
}

/**
 * Whether a stack described by `descriptor` is still running. Requires both the
 * control process to be alive AND its devchain RPC to answer — a stack whose
 * control process died or whose chain stopped is treated as dead. Note: a stack
 * mid-boot (process up, chain not yet listening) reads as dead here; callers
 * that prune during startup must account for that (ADR 0020, Phase 2).
 */
export async function isDescriptorAlive(
  descriptor: StackDescriptor,
): Promise<boolean> {
  if (!isProcessAlive(descriptor.controlPid)) {
    return false;
  }

  return isRpcReady(`http://127.0.0.1:${descriptor.chainPort}`);
}

/**
 * Removes descriptors for stacks that are no longer alive and returns the
 * survivors. This is how crashed or force-killed stacks release their slot:
 * the next stack to start prunes them before choosing its own slot (ADR 0020).
 */
export async function pruneDeadDescriptors(): Promise<StackDescriptor[]> {
  const liveDescriptors: StackDescriptor[] = [];

  for (const descriptor of readDescriptors()) {
    if (await isDescriptorAlive(descriptor)) {
      liveDescriptors.push(descriptor);
    } else {
      removeDescriptor(descriptor.instanceId);
    }
  }

  return liveDescriptors;
}
