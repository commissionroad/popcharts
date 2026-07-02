import { setTimeout } from "node:timers/promises";

/**
 * Pauses async control flow for polling and retry intervals.
 */
export function sleep(ms: number): Promise<void> {
  return setTimeout(ms);
}
