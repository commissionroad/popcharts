import { detectStackKind, type StackKind } from "./identity.ts";
import { deriveStackResources, type StackPorts } from "./ports.ts";
import type { StackDescriptor } from "./registry.ts";

const MAX_SLOT_SEARCH_ATTEMPTS = 64;

type ResolveSlotOptions = {
  cwd: string;
  explicitSlot?: number | undefined;
  liveDescriptors: StackDescriptor[];
  isPortFree: (port: number) => Promise<boolean>;
};

function bindablePorts(resources: StackPorts): number[] {
  return [
    resources.chainPort,
    resources.apiPort,
    resources.appPort,
    resources.reviewPort,
    resources.resolutionPort,
    resources.pcAdminPort,
  ];
}

async function firstOccupiedPort(
  resources: StackPorts,
  isPortFree: ResolveSlotOptions["isPortFree"],
): Promise<number | undefined> {
  for (const port of bindablePorts(resources)) {
    if (!(await isPortFree(port))) {
      return port;
    }
  }

  return undefined;
}

export async function resolveSlot(
  options: ResolveSlotOptions,
): Promise<{ slot: number; kind: StackKind }> {
  const kind = detectStackKind(options.cwd);

  if (options.explicitSlot !== undefined) {
    const resources = deriveStackResources(options.explicitSlot);
    const claimant = options.liveDescriptors.find(
      (descriptor) => descriptor.slot === options.explicitSlot,
    );
    if (claimant) {
      throw new Error(
        `Stack slot ${options.explicitSlot} is already claimed by ${claimant.instanceId}.`,
      );
    }

    const occupiedPort = await firstOccupiedPort(resources, options.isPortFree);
    if (occupiedPort !== undefined) {
      throw new Error(
        `Stack slot ${options.explicitSlot} cannot be used because ` +
          `port ${occupiedPort} is occupied.`,
      );
    }

    return { slot: options.explicitSlot, kind };
  }

  const firstCandidate = kind === "human" ? 0 : 1;
  for (let offset = 0; offset < MAX_SLOT_SEARCH_ATTEMPTS; offset += 1) {
    const candidate = firstCandidate + offset;
    if (options.liveDescriptors.some((descriptor) => descriptor.slot === candidate)) {
      continue;
    }

    const resources = deriveStackResources(candidate);
    if ((await firstOccupiedPort(resources, options.isPortFree)) === undefined) {
      return { slot: candidate, kind };
    }
  }

  throw new Error(
    `No free local stack slot found after ${MAX_SLOT_SEARCH_ATTEMPTS} attempts.`,
  );
}
