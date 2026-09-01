#!/usr/bin/env bash
#
# Setup script for a Claude Code cloud environment: makes `pnpm install` and
# `hardhat build` work inside a cloud session, without changing anything the
# repository ships to laptops or CI.
#
# Point a cloud environment's setup script at this file:
#
#   bash scripts/ci/cloud-setup.sh
#
# Two things are broken in a cloud session and neither is a repo defect:
#
# 1. `forge-std` resolves through a codeload.github.com tarball. The session's
#    GitHub proxy serves codeload only for repositories attached to the session,
#    so the fetch returns 403 for a third-party repo and `pnpm install` dies.
#    Resolving the same pinned commit over git works, because the session
#    rewrites SSH-form GitHub remotes to HTTPS.
#
#    That rewrite is exactly why this belongs here and NOT in
#    protocol/package.json: pnpm records a git dependency's identity in SSH
#    form, and GitHub Actions has neither the rewrite nor a deploy key, so
#    committing the git spec turns CI red with
#    `git@github.com: Permission denied (publickey)`. Verified the hard way.
#
#    So the spec is swapped, installed, and swapped back — the checkout ends
#    byte-identical to what was cloned, with node_modules populated.
#
# 2. Hardhat's solc downloader ignores the proxy; see seed-solc-cache.sh.
#
# Both installs happen inside the swap window. `server/` has its own bun.lock
# and depends on the protocol workspace as `file:../protocol`, so `bun install`
# re-resolves protocol's dependencies and hits the same 403 that pnpm does —
# running it after the spec was restored is how a session ends up with a
# working pnpm workspace and a server that still cannot install. CI does the
# same two installs in the same order (see .github/workflows/server-ci.yml).
#
# Idempotent, and safe to run on an already-set-up checkout.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

PACKAGE_JSON="protocol/package.json"
LOCKFILE="pnpm-lock.yaml"
TARBALL_SPEC='"forge-std": "github:foundry-rs/forge-std#v1.9.7"'
GIT_SPEC='"forge-std": "git+https://github.com/foundry-rs/forge-std.git#v1.9.7"'

restore_specs() {
  # Always put the committed dependency spec back, even on failure: leaving the
  # git spec behind would make the session's diffs and any PR it opens carry a
  # change that breaks CI.
  git checkout HEAD -- "$PACKAGE_JSON" "$LOCKFILE" 2>/dev/null || true
}

echo "cloud-setup: seeding the solc compiler cache"
bash "$REPO_ROOT/scripts/ci/seed-solc-cache.sh"

# Runs every install this checkout is missing. Called with the forge-std spec
# already swapped, so both resolvers see a spec they can fetch.
install_missing() {
  local pnpm_args=("$@")

  if [ ! -d "protocol/node_modules" ]; then
    echo "cloud-setup: installing the pnpm workspace"
    pnpm install "${pnpm_args[@]}"
  fi

  if [ ! -d "server/node_modules" ]; then
    if command -v bun >/dev/null 2>&1; then
      echo "cloud-setup: installing the server workspace with bun"

      # bun is expected to fail here, and the failure is survivable.
      #
      # The spec swap does not help bun the way it helps pnpm: bun fetches a
      # git dependency through api.github.com's tarball endpoint, which this
      # session refuses (403) exactly as it refuses codeload. So forge-std is
      # unreachable for bun under either spec.
      #
      # That is tolerable because forge-std is a *devDependency of the
      # protocol workspace*, which the server reaches only as
      # `file:../protocol`. The server needs protocol's source and runtime
      # deps, never its Solidity test library. bun installs everything else
      # and fails at the end on that one package.
      #
      # "Tolerable" is verified rather than assumed: the install is only
      # accepted if the resulting tree actually contains the server's own
      # dependencies. Otherwise this would paper over a genuinely broken
      # install and hand the session a node_modules that fails much later,
      # somewhere far less obvious.
      if (cd server && bun install --no-save); then
        echo "cloud-setup: server workspace installed"
      elif [ -d "server/node_modules/viem" ] && [ -d "server/node_modules/drizzle-orm" ]; then
        echo "cloud-setup: bun could not fetch forge-std (a protocol devDependency" >&2
        echo "cloud-setup: the server does not need); the rest of the server tree" >&2
        echo "cloud-setup: installed and is usable. Continuing." >&2
      else
        echo "cloud-setup: bun install failed and left an unusable server tree." >&2
        return 1
      fi
    else
      echo "cloud-setup: bun is not installed; skipping the server workspace." >&2
    fi
  fi
}

if [ ! -d "protocol/node_modules" ] || [ ! -d "server/node_modules" ]; then
  if ! grep -qF "$TARBALL_SPEC" "$PACKAGE_JSON"; then
    echo "cloud-setup: forge-std spec in $PACKAGE_JSON is not the expected" >&2
    echo "cloud-setup: tarball form; skipping the swap and installing as-is." >&2
    install_missing --frozen-lockfile
  else
    trap restore_specs EXIT
    # sed over the exact committed string, so an unrelated edit to this line
    # fails the grep above rather than being silently rewritten.
    sed -i.bak "s|$TARBALL_SPEC|$GIT_SPEC|" "$PACKAGE_JSON"
    rm -f "$PACKAGE_JSON.bak"

    # Not --frozen-lockfile: the swapped spec deliberately disagrees with the
    # committed lockfile, and the lockfile is restored immediately afterwards.
    install_missing --no-frozen-lockfile

    restore_specs
    trap - EXIT
    echo "cloud-setup: dependency specs restored to the committed form"
  fi
else
  echo "cloud-setup: dependencies already installed"
fi

# A later `pnpm install` in this session reverts to the committed tarball spec
# and will fail again on codeload. Re-run this script instead of pnpm directly.
echo "cloud-setup: done"
