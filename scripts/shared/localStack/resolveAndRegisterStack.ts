import { repoRoot } from "../paths.ts";
import { deriveInstanceId, type StackKind } from "./identity.ts";
import { isPortFree } from "./isPortFree.ts";
import { deriveStackResources, type StackPorts } from "./ports.ts";
import { readSlotFromEnv } from "./readSlotFromEnv.ts";
import {
  pruneDeadDescriptors,
  removeDescriptor,
  writeDescriptor,
  type StackDescriptor,
} from "./registry.ts";
import { resolveSlot } from "./slot.ts";

/**
 * A resolved local-stack claim after its descriptor has been registered and
 * its child-process environment has been populated.
 */
export type RegisteredStack = {
  slot: number;
  kind: StackKind;
  instanceId: string;
  resources: StackPorts;
};

/**
 * Resolves and registers the local-stack slot owned by `cwd`. Dead registry
 * entries are pruned before slot selection; an explicit
 * `POPCHARTS_STACK_SLOT` is honored when present, otherwise the first free
 * slot for the detected stack kind is selected. The resulting descriptor is
 * written with this process as its controller, best-effort cleanup is attached
 * to normal exit and termination signals, and the slot-derived child-process
 * environment is applied to `process.env` before the registered stack is
 * returned (ADR 0020). `portProbe` defaults to the real loopback bind check;
 * tests may inject a deterministic probe to avoid depending on ambient ports.
 */
export async function resolveAndRegisterStack(
  cwd: string,
  portProbe: (port: number) => Promise<boolean> = isPortFree,
): Promise<RegisteredStack> {
  const live = await pruneDeadDescriptors();
  const explicitSlot =
    process.env.POPCHARTS_STACK_SLOT === undefined
      ? undefined
      : readSlotFromEnv(process.env);
  const { slot, kind } = await resolveSlot({
    cwd,
    explicitSlot,
    liveDescriptors: live,
    isPortFree: portProbe,
  });
  const resources = deriveStackResources(slot);
  const instanceId = deriveInstanceId(cwd, slot);
  const descriptor: StackDescriptor = {
    instanceId,
    slot,
    kind,
    worktreePath: repoRoot,
    chainPort: resources.chainPort,
    chainId: resources.chainId,
    apiPort: resources.apiPort,
    appPort: resources.appPort,
    reviewPort: resources.reviewPort,
    resolutionPort: resources.resolutionPort,
    pcAdminPort: resources.pcAdminPort,
    dbName: resources.dbName,
    envFilePath: resources.envFilePath,
    deployAddressesPath: null,
    controlPid: process.pid,
    startedAt: new Date().toISOString(),
  };
  writeDescriptor(descriptor);
  registerDescriptorCleanup(instanceId);

  Object.assign(process.env, {
    POPCHARTS_STACK_SLOT: String(slot),
    LOCAL_API_PORT: String(resources.apiPort),
    LOCAL_APP_PORT: String(resources.appPort),
    LOCAL_AI_REVIEW_PORT: String(resources.reviewPort),
    LOCAL_AI_RESOLUTION_PORT: String(resources.resolutionPort),
    // Protocol deploy scripts pick their chain from two different vars: the
    // hardhat `localhost` network reads POPCHARTS_LOCAL_RPC_URL, while the
    // deploy scripts' own viem clients read POPCHARTS_RPC_URL. Both default to
    // :8545, so without pinning them here every `--network localhost` deploy
    // (pregrad, venue, postgrad, demo) lands on slot 0's chain instead of this
    // slot's. Scoped to local orchestrators, which only ever deploy locally.
    POPCHARTS_LOCAL_RPC_URL: resources.chainRpcHttpUrl,
    POPCHARTS_RPC_URL: resources.chainRpcHttpUrl,
  });

  return { slot, kind, instanceId, resources };
}

function registerDescriptorCleanup(instanceId: string): void {
  const cleanup = (): void => {
    try {
      removeDescriptor(instanceId);
    } catch (error) {
      console.warn(
        `[local-stack] could not remove stack descriptor: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  };

  process.once("exit", cleanup);
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
}
