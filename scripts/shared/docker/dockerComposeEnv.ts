/** Compose project name shared by every local Pop Charts orchestrator. */
export const COMPOSE_PROJECT_NAME = "popcharts";

/** Container name of the local Postgres started by docker-compose. */
export const POSTGRES_CONTAINER_NAME = "popcharts-postgres";

/**
 * Returns an environment with the shared COMPOSE_PROJECT_NAME applied, so
 * every script addresses the same Compose project regardless of which
 * directory or worktree it runs from.
 */
export function dockerComposeEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...env,
    COMPOSE_PROJECT_NAME,
  };
}
