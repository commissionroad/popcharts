import type { StackDescriptor } from "./registry.ts";

/** The ownership states that govern whether a live local RPC may be reused. */
export type ChainPortOwnership =
  | "free"
  | "this-instance"
  | "foreign-or-unknown";

/**
 * Classifies a stack's chain port from its observed RPC state and the live
 * registry. A responding port is reusable only when this exact instance owns
 * it; every unclaimed or foreign responder is rejected (ADR 0020).
 */
export function classifyChainPortOwnership(options: {
  readonly chainPort: number;
  readonly instanceId: string;
  readonly isRpcResponding: boolean;
  readonly liveDescriptors: readonly StackDescriptor[];
}): ChainPortOwnership {
  if (!options.isRpcResponding) {
    return "free";
  }

  return options.liveDescriptors.some(
    (descriptor) =>
      descriptor.instanceId === options.instanceId &&
      descriptor.chainPort === options.chainPort,
  )
    ? "this-instance"
    : "foreign-or-unknown";
}
