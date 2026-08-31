#!/usr/bin/env bash
#
# Pre-populates Hardhat's solc compiler cache so `hardhat build` never has to
# download a compiler itself.
#
# Why this exists: Hardhat 3's compiler downloader builds its own undici Agent
# (`getBasicDispatcher` in @nomicfoundation/hardhat-utils) and never passes a
# proxy, so its requests ignore HTTPS_PROXY and go out directly. In a sandbox
# that forces egress through an explicit CONNECT proxy, that direct request is
# refused with `x-deny-reason: host_not_allowed`, and `hardhat build` fails
# with HHE905/HHE904 even though the compiler host is perfectly reachable
# through the proxy. NODE_USE_ENV_PROXY does not help: it sets undici's
# *global* dispatcher, which hardhat-utils does not use.
#
# curl does honour the proxy, so fetching the same files with curl and leaving
# them where Hardhat would have put them sidesteps the problem without changing
# a dependency or disabling a check. Every binary is verified against the
# sha256 published in the official build list before it is installed.
#
# Both the native platform and wasm are seeded. Hardhat consults both build
# lists on every run, and picks the wasm build in some configurations, so
# seeding only the native platform still leaves the build broken.
#
# Intended for the setup script of a Claude Code cloud environment, and
# harmless anywhere else: it is a no-op once the cache is warm.
#
# Usage: scripts/ci/seed-solc-cache.sh [version ...]
#        Defaults to the versions in protocol/hardhat.config.ts.

set -euo pipefail

DEFAULT_VERSIONS=("0.8.28" "0.8.26")
VERSIONS=("${@:-${DEFAULT_VERSIONS[@]}}")

case "$(uname -s)/$(uname -m)" in
  Linux/x86_64) PLATFORM="linux-amd64" ;;
  Linux/aarch64 | Linux/arm64) PLATFORM="linux-arm64" ;;
  Darwin/*) PLATFORM="macosx-amd64" ;;
  *)
    echo "seed-solc-cache: unsupported platform $(uname -s)/$(uname -m); leaving Hardhat to download." >&2
    exit 0
    ;;
esac

CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/hardhat-nodejs/compilers-v3"
REPOSITORY="https://binaries.soliditylang.org"

fetch() {
  # --fail so a missing asset is an error rather than an HTML body written to
  # the destination path, which would only fail later as a corrupt binary.
  curl --fail --location --silent --show-error \
    --retry 3 --retry-delay 2 --connect-timeout 15 \
    --output "$1" "$2"
}

# Seeds one platform's list and the requested compiler builds.
seed_platform() {
  local platform="$1"
  shift
  local dir="$CACHE_ROOT/$platform"
  local base="$REPOSITORY/$platform"

  mkdir -p "$dir"

  if ! fetch "$dir/list.json.tmp" "$base/list.json"; then
    rm -f "$dir/list.json.tmp"
    echo "seed-solc-cache: could not fetch the $platform compiler list; leaving Hardhat to try." >&2
    return 0
  fi
  mv "$dir/list.json.tmp" "$dir/list.json"

  local version build_path expected_sha target
  for version in "$@"; do
    # Read the filename and its expected digest from the same list entry, so
    # the two can never be taken from different builds.
    read -r build_path expected_sha < <(
      VERSION="$version" python3 - "$dir/list.json" <<'PY'
import json, os, sys

version = os.environ["VERSION"]
builds = json.load(open(sys.argv[1]))["builds"]
match = next(
    (b for b in builds if b["version"] == version and b.get("prerelease") is None),
    None,
)
if match is None:
    raise SystemExit(f"no build for solc {version}")
# keccak256 is published too; sha256 is what coreutils can check.
print(match["path"], match["sha256"].removeprefix("0x"))
PY
    )

    target="$dir/$build_path"

    if [ -f "$target" ] && echo "$expected_sha  $target" | sha256sum --check --status; then
      echo "seed-solc-cache: $platform solc $version already cached"
      continue
    fi

    echo "seed-solc-cache: fetching $platform solc $version ($build_path)"
    fetch "$target.tmp" "$base/$build_path"

    if ! echo "$expected_sha  $target.tmp" | sha256sum --check --status; then
      rm -f "$target.tmp"
      echo "seed-solc-cache: checksum mismatch for $platform solc $version" >&2
      exit 1
    fi

    mv "$target.tmp" "$target"
    chmod +x "$target"
  done
}

echo "seed-solc-cache: cache root $CACHE_ROOT"
seed_platform "$PLATFORM" "${VERSIONS[@]}"
seed_platform "wasm" "${VERSIONS[@]}"
echo "seed-solc-cache: done"
