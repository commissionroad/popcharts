#!/usr/bin/env bash
# Run Slither over the protocol contracts (Phase 0 tooling for ADR 0023).
#
# Does a clean build (so all Hardhat 3 build-info is from one consistent
# compilation), reshapes it into a Slither-readable tree, and runs Slither's
# detectors scoped to project/contracts. Requires a modern Slither installed in
# isolation:  uv tool install slither-analyzer   (needs >= 0.11; the Homebrew
# 0.9.x is too old for file-level `using-for`). See ./README.md.
#
# Usage (from anywhere):  protocol/scripts/security/slither.sh [--json out.json]
set -euo pipefail

cd "$(dirname "$0")/../.."   # -> protocol/

if ! command -v uv >/dev/null 2>&1; then
  echo "error: uv not found (need it to run the isolated Slither). See scripts/security/README.md" >&2
  exit 1
fi

echo "[slither] clean build for a consistent build-info set…"
npx hardhat clean
npx hardhat build

echo "[slither] preparing Slither-readable tree…"
node scripts/security/slither-prepare.mjs

echo "[slither] analyzing project/contracts…"
uv tool run --from slither-analyzer python scripts/security/slither-run.py .slither "$@"
