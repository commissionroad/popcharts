/**
 * Narrows an unknown value to an indexable object so parsed JSON can be read
 * key by key without `any`. Arrays satisfy it, matching a bare `typeof` check —
 * callers that need a plain object test `Array.isArray` themselves.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Walks `path` through parsed JSON, yielding `undefined` at the first key whose
 * container is not an object instead of throwing. Use the typed readers below
 * when a missing value should fail the run.
 */
export function readJsonPath(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (!isRecord(current)) {
      return undefined;
    }

    return current[key];
  }, value);
}

/**
 * The non-blank string at `path`, or a throw naming the dotted path. A
 * whitespace-only value counts as missing: it reads as present but is never a
 * usable URL or identifier.
 */
export function readJsonString(
  value: unknown,
  path: readonly string[],
): string {
  const current = readJsonPath(value, path);

  if (typeof current !== "string" || current.trim().length === 0) {
    throw new Error(`${path.join(".")} is missing from source response.`);
  }

  return current;
}

/**
 * The array at `path`, or a throw naming the dotted path. Elements stay
 * `unknown`: this validates the container, not its contents.
 */
export function readJsonArray(
  value: unknown,
  path: readonly string[],
): unknown[] {
  const current = readJsonPath(value, path);

  if (!Array.isArray(current)) {
    throw new Error(`${path.join(".")} is missing from source response.`);
  }

  return current;
}
