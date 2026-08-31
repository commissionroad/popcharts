#!/usr/bin/env bash
#
# In-session bootstrap for a cloud session that is not already provisioned.
#
# Run it from a checkout, by hand or by asking Claude, when a session comes up
# without node_modules, without the Postgres image, or without the solc
# compilers -- for example the first session in a new environment, or one
# whose environment has no Setup script configured.
#
# It is NOT the environment's "Setup script" field. That field takes script
# text and runs before Claude Code launches, so a script pasted there cannot
# rely on the repository being present, and anything it does relies on
# `$(dirname "$0")` resolving inside the checkout, which this one does. A
# non-zero exit there also stops the session from starting at all, while this
# script deliberately fails loudly. Put only VM-level provisioning that needs
# no repository -- the image pull and the compiler seeding below -- in that
# field, and let it exit zero whatever happens.
#
# The environment cache snapshots the filesystem after that field's script
# runs, and keeps FILES ONLY, not running processes. Starting dockerd and the
# Postgres container happens per session, in the SessionStart hook that runs
# scripts/cloud-session-start.sh.
#
# Four network limitations are worked around below. All four disappear if the
# environment's network access is set to Custom with these hosts added to the
# Trusted defaults, which is the cleaner fix:
#
#   production.cloudfront.docker.com   (Docker Hub blob CDN)
#   binaries.soliditylang.org          (solc downloads)
#
# The forge-std workaround (step 4) is needed regardless, because it is the
# GitHub credential proxy -- not the network allowlist -- that refuses tarball
# downloads from api.github.com and codeload.github.com.
#
# Nothing here modifies tracked files: step 4 patches protocol/package.json in
# place, installs, and restores it, leaving the working tree clean. That is
# deliberate -- the constraint is specific to this environment, so the fix
# belongs to the environment rather than to the shared manifest. See the note
# in step 4 for why the obvious manifest change is the wrong answer.

set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

# ---------------------------------------------------------------------------
# 1. Docker daemon
#
# Installed but not running at session start.
# ---------------------------------------------------------------------------
if ! docker info >/dev/null 2>&1; then
  echo "==> starting dockerd"
  nohup dockerd >/tmp/dockerd.log 2>&1 &
  for _ in $(seq 1 30); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
  docker info >/dev/null 2>&1 || { echo "dockerd failed to start"; exit 1; }
fi

# ---------------------------------------------------------------------------
# 2. Postgres image, via Google's Docker Hub mirror
#
# `docker pull postgres:16-alpine` fails on the Trusted allowlist: the Docker
# Hub manifest API is reachable, but the blob CDN it redirects to
# (production.cloudfront.docker.com) is not. The allowlist carries
# production.cloudflare.docker.com, which Docker Hub no longer uses.
#
# mirror.gcr.io is a Docker Hub pull-through cache and matches the
# allowlisted *.gcr.io wildcard, so it serves the identical image. Tagging it
# under the original name lets docker-compose.yml use it with no edits.
# ---------------------------------------------------------------------------
echo "==> pulling postgres:16-alpine via mirror.gcr.io"
docker pull mirror.gcr.io/library/postgres:16-alpine
docker tag mirror.gcr.io/library/postgres:16-alpine postgres:16-alpine

# ---------------------------------------------------------------------------
# 3. Solidity compilers, via the solc-bin GitHub mirror
#
# Hardhat downloads solc from binaries.soliditylang.org, which is not on the
# allowlist. The same binaries are mirrored in the ethereum/solc-bin repo on
# raw.githubusercontent.com, which is allowed.
#
# Hardhat needs BOTH the native and the WASM build of every configured
# version -- downloadSolcCompilers() fetches the WASM one unconditionally.
# Versions come from protocol/hardhat.config.ts.
# ---------------------------------------------------------------------------
SOLC_VERSIONS=("0.8.28" "0.8.26")
SOLC_MIRROR="https://raw.githubusercontent.com/ethereum/solc-bin/gh-pages"
CACHE_ROOT="${HOME}/.cache/hardhat-nodejs/compilers-v3"

seed_solc() {
  # $1 = platform dir ("linux-amd64" or "wasm")
  # $2 = mirror subdirectory holding the real files for that platform
  local platform="$1" srcdir="$2" dest="${CACHE_ROOT}/$1"
  mkdir -p "${dest}"
  curl -fsSL -o "${dest}/list.json" "${SOLC_MIRROR}/${platform}/list.json"

  for version in "${SOLC_VERSIONS[@]}"; do
    local build_path
    build_path="$(python3 -c "
import json, sys
builds = json.load(open('${dest}/list.json'))['builds']
print(next(b['path'] for b in builds
           if b['version'] == '${version}' and not b.get('prerelease')))
")"
    # The wasm/ directory holds symlinks; bin/ holds the real files.
    curl -fsSL -o "${dest}/${build_path}" "${SOLC_MIRROR}/${srcdir}/${build_path}"
    chmod +x "${dest}/${build_path}"

    python3 -c "
import json, hashlib, sys
builds = json.load(open('${dest}/list.json'))['builds']
build = next(b for b in builds
             if b['version'] == '${version}' and not b.get('prerelease'))
digest = hashlib.sha256(open('${dest}/' + build['path'], 'rb').read()).hexdigest()
if digest != build['sha256'][2:]:
    sys.exit('checksum mismatch for ${platform} ${version}')
print('  ${platform} ${version} ok')
"
  done
}

echo "==> seeding solc compilers"
seed_solc "linux-amd64" "linux-amd64"
seed_solc "wasm" "bin"

# ---------------------------------------------------------------------------
# 4. Dependencies
#
# protocol/package.json declares forge-std as a GitHub dependency. Neither
# package manager can fetch it as a tarball here: the GitHub credential proxy
# authenticates git operations but returns 403 for codeload.github.com and
# api.github.com tarball URLs ("No authorization header was set").
#
# pnpm honours the git+https:// form and does a real clone, which succeeds. It
# is tempting to just make that change permanently in protocol/package.json --
# don't. pnpm normalises any git specifier for a GitHub repo down to the SSH
# form (`repo: git@github.com:foundry-rs/forge-std.git`) when it writes the
# lockfile. That resolves here only because this environment injects
# `url.https://github.com/.insteadOf git@github.com:` and would otherwise need
# an SSH key. Committing it would hand every HTTPS-only contributor and CI job
# a dependency they cannot fetch. So the specifier is patched in place, used,
# and reverted.
#
# bun is worse: it resolves every git dependency through the api.github.com
# tarball endpoint, so no specifier form works. forge-std is a Solidity-only
# devDependency and nothing under server/ compiles Solidity, so it is dropped
# outright for that one install. pnpm has already populated
# protocol/node_modules/forge-std by then, so the Solidity tests still build.
#
# Because the manifests are restored afterwards, do not re-run a plain
# `pnpm install` in a session -- it would try the blocked tarball again. The
# environment snapshot keeps node_modules, so there is no reason to.
# ---------------------------------------------------------------------------
restore_manifest() {
  [ -f /tmp/protocol-package.json.bak ] &&
    cp /tmp/protocol-package.json.bak "${REPO_ROOT}/protocol/package.json"
}
trap restore_manifest EXIT

cp protocol/package.json /tmp/protocol-package.json.bak

echo "==> pnpm install"
python3 - <<'PY'
path = 'protocol/package.json'
source = open(path).read()
open(path, 'w').write(source.replace(
    '"forge-std": "github:foundry-rs/forge-std#v1.9.7"',
    '"forge-std": "git+https://github.com/foundry-rs/forge-std.git#v1.9.7"',
))
PY
pnpm install --no-frozen-lockfile
restore_manifest
git checkout -- pnpm-lock.yaml

# bun.lock caches the resolved GitHub tarball for forge-std independently of
# protocol/package.json, so the entry has to come out of both or bun will keep
# retrying the blocked URL.
echo "==> bun install (server)"
python3 - <<'PY'
import re

source = open('protocol/package.json').read()
open('protocol/package.json', 'w').write(
    re.sub(r'^\s*"forge-std": "[^"]*",\n', '', source, flags=re.M)
)

lock = open('server/bun.lock').read()
# the devDependency reference inside the @popcharts/protocol workspace entry
lock = re.sub(r'"forge-std": "[^"]*", ', '', lock)
# the resolved-package line
lock = re.sub(r'^\s*"forge-std": \["forge-std@[^\n]*\n', '', lock, flags=re.M)
open('server/bun.lock', 'w').write(lock)
PY
( cd server && bun install --no-frozen-lockfile )
restore_manifest
git checkout -- server/bun.lock

echo "==> working tree clean:"
git status --porcelain || true

echo
echo "Setup complete. The Docker daemon and the Postgres container are started"
echo "per session by the SessionStart hook in .claude/settings.json, which runs"
echo "scripts/cloud-session-start.sh. Run that now if you need them before the"
echo "next session starts."
echo
echo "For the Playwright lanes, also export:"
echo "  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium"
echo "  PLAYWRIGHT_EXPECT_TIMEOUT_MS=60000"
echo
echo "The first points Playwright at the preinstalled browser, since the"
echo "version this repo pins expects a build number the image does not carry"
echo "and the Playwright CDN is off the allowlist. The second covers route"
echo "compilation in \`next dev\`, which outruns the 5s default on a small box."
