/**
 * Resolves `path` against an API base URL that may or may not end in a slash.
 * `new URL` discards the last segment of a base without a trailing slash, so a
 * configured base like `http://127.0.0.1:3001/api` would otherwise silently
 * lose its `/api` prefix.
 */
export function resolveApiUrl({
  baseUrl,
  path,
}: {
  readonly baseUrl: string;
  readonly path: string;
}): URL {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
}
