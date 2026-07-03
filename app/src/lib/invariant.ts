/**
 * Throws with the given message unless the condition holds, and narrows the
 * condition's type for the code that follows. Use it to fail loudly at
 * boundaries instead of letting bad state flow inward.
 */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
