import { assertValidSlot } from "./assertValidSlot.ts";

/**
 * Reads the local-stack slot from `POPCHARTS_STACK_SLOT`, defaulting to the
 * legacy slot 0 when the variable is absent. Rejects malformed values at the
 * process boundary so every child derives the same resources (ADR 0020).
 */
export function readSlotFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const rawSlot = env.POPCHARTS_STACK_SLOT;
  if (rawSlot === undefined || rawSlot === "") {
    return 0;
  }

  const slot = Number(rawSlot);
  assertValidSlot(slot);
  return slot;
}
