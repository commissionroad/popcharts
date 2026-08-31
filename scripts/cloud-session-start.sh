#!/usr/bin/env bash
#
# Per-session startup for Claude Code cloud environments.
#
# The environment cache snapshots the filesystem after the setup script
# (scripts/cloud-session-setup.sh) runs, so node_modules, the Postgres image and
# the solc compilers all survive into later sessions. Running processes do not.
# This script starts the two that have to come back each session: the Docker
# daemon, and the shared Postgres container the local orchestrators expect.
#
# Wired as a SessionStart hook in .claude/settings.json, backgrounded so it
# never delays a session. Progress goes to .local-dev/logs/session-start.log.
#
# This is a no-op unless it is actually running in a cloud session. On a
# contributor's machine Docker is already running (or is Docker Desktop, which
# has no `dockerd` binary at all), and starting containers behind their back is
# not this script's business. Set POPCHARTS_SESSION_START_STACK=1 to force it on
# or =0 to force it off.

set -uo pipefail

cd "$(dirname "$0")/.."

LOG_DIR=".local-dev/logs"
mkdir -p "${LOG_DIR}" 2>/dev/null || true
LOG="${LOG_DIR}/session-start.log"

log() { printf '%s %s\n' "$(date -u +%H:%M:%SZ)" "$*" >> "${LOG}"; }

should_run() {
  case "${POPCHARTS_SESSION_START_STACK:-}" in
    1) return 0 ;;
    0) return 1 ;;
  esac
  # Two independent markers, so a rename of either one does not silently
  # disable the hook.
  [ -n "${CLAUDE_CODE_CONTAINER_ID:-}" ] || [ "${CCR_AGENT_PROXY_ENABLED:-}" = "1" ]
}

if ! should_run; then
  log "not a cloud session; skipping (set POPCHARTS_SESSION_START_STACK=1 to force)"
  exit 0
fi

if ! command -v dockerd >/dev/null 2>&1; then
  log "no dockerd binary; nothing to start"
  exit 0
fi

if docker info >/dev/null 2>&1; then
  log "docker daemon already up"
else
  log "starting dockerd"
  setsid nohup dockerd >/tmp/dockerd.log 2>&1 < /dev/null &
  for _ in $(seq 1 30); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
  if docker info >/dev/null 2>&1; then
    log "dockerd up"
  else
    log "dockerd failed to start; see /tmp/dockerd.log"
    exit 1
  fi
fi

# Compose pulls when the tag is absent locally, and the pull is blocked on the
# default network policy, so check first and say so rather than hanging on a
# fetch that cannot succeed. scripts/cloud-session-setup.sh is what puts the
# image there.
if ! docker image inspect postgres:16-alpine >/dev/null 2>&1; then
  log "postgres:16-alpine missing; run scripts/cloud-session-setup.sh"
  exit 1
fi

if [ "$(docker inspect -f '{{.State.Running}}' popcharts-postgres 2>/dev/null)" = "true" ]; then
  log "postgres already running"
  exit 0
fi

log "starting postgres"
docker compose up -d postgres >> "${LOG}" 2>&1 || {
  log "docker compose up failed"
  exit 1
}

for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' popcharts-postgres 2>/dev/null)" = "healthy" ] && break
  sleep 1
done

if [ "$(docker inspect -f '{{.State.Health.Status}}' popcharts-postgres 2>/dev/null)" = "healthy" ]; then
  log "postgres healthy on 5433"
else
  log "postgres did not become healthy in time"
  exit 1
fi
