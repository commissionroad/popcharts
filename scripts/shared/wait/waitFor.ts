import { sleep } from "./sleep.ts";

/**
 * Polls a predicate every 500ms until it returns a truthy value, then returns
 * that value. Throws after `timeoutMs` (default 30s), including the last
 * predicate error for context. An optional `ensure` callback runs before each
 * poll so callers can fail fast when a prerequisite process has died instead
 * of timing out with stale context.
 */
export async function waitFor<T>(
  label: string,
  predicate: () => Promise<T | null | undefined | false> | T,
  options: {
    readonly ensure?: () => void;
    readonly logLabel?: string;
    readonly timeoutMs?: number;
  } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    options.ensure?.();

    try {
      const value = await predicate();

      if (value) {
        if (options.logLabel) {
          console.log(`[${options.logLabel}] ${label} ready`);
        }
        return value;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(500);
  }

  const suffix =
    lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(
    `${label} did not become ready within ${timeoutMs}ms.${suffix}`,
  );
}
