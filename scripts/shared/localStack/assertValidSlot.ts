/**
 * Throws unless `slot` is a valid stack slot: a non-negative integer. Shared by
 * every function that accepts a slot so the guard and its message have exactly
 * one definition (ADR 0020).
 */
export function assertValidSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0) {
    throw new Error(
      `Stack slot must be a non-negative integer; received ${slot}.`,
    );
  }
}
