const DEFAULT_API_PORT = "3001";

/**
 * Resolves the local indexer API base URL the same way the local dev stack
 * does: an explicit CLI value wins, then the POPCHARTS_INDEXER_API_URL
 * overrides, then the generated env file's port.
 */
export function resolveIndexerApiBaseUrl(
  explicitUrl: string | undefined,
  env: NodeJS.ProcessEnv,
): string {
  return (
    explicitUrl ??
    env.POPCHARTS_INDEXER_API_URL ??
    env.NEXT_PUBLIC_POPCHARTS_INDEXER_API_URL ??
    `http://127.0.0.1:${env.LOCAL_API_PORT ?? env.PORT ?? DEFAULT_API_PORT}`
  );
}
