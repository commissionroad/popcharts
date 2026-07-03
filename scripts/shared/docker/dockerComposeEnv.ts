/** Compose project name shared by every local Pop Charts orchestrator. */
export const COMPOSE_PROJECT_NAME = "popcharts";

/** Container name of the local Postgres started by docker-compose. */
export const POSTGRES_CONTAINER_NAME = "popcharts-postgres";

/**
 * Data volume Compose creates for the local Postgres under the shared
 * project name. Orchestrators verify the running container actually mounts
 * this volume so resets clear the data developers think they clear.
 */
export const POSTGRES_VOLUME_NAME = `${COMPOSE_PROJECT_NAME}_postgres_data`;

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
