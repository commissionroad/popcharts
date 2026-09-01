/**
 * The pinned Arc node release used by every local chain, and the checksums
 * that make fetching it verifiable.
 *
 * This file is the single source of truth for the version. Bumping the pin
 * is a deliberate act: `ARC_NODE_VERSION` and the digests below move
 * together, and nothing else in the repo names a version.
 *
 * Why v0.7.1 rather than the newest release, or the one Arc Testnet runs:
 * Arc Testnet runs v0.6.0, which publishes **no release binaries at all** —
 * every target 404s, so matching testnet exactly would mean a full reth
 * compile on every machine. v0.7.1 is the lowest release that ships
 * binaries, which makes it the closest we can get to testnet without
 * building from source. See ADR 0028 G12/D3 for the probe results and the
 * residual skew this leaves (local carries the zero7 hardfork; testnet does
 * not, and neither carries zero8).
 */

/** The pinned release tag. Bump with the digests below, never alone. */
export const ARC_NODE_VERSION = "v0.7.1";

/**
 * Rust target triples we can fetch a prebuilt binary for, mapped to the
 * sha256 of that target's release archive.
 *
 * `x86_64-apple-darwin` is deliberately absent: Circle publishes no Intel
 * macOS build. `resolveArcNodeTarget` reports that as an unsupported
 * platform rather than falling back to a mismatched archive.
 */
export const ARC_NODE_ARCHIVE_SHA256: Readonly<Record<string, string>> = {
  "aarch64-apple-darwin":
    "3b94b29a47eb84dfd0ee74f94203eb62f41749bc633cc1ef3a4fb1b3cba623db",
  "aarch64-unknown-linux-gnu":
    "bed973a3d366f11e79f65d6832812dd37a632b0d9e652441c83de26ef917a8fd",
  "x86_64-unknown-linux-gnu":
    "0e1081e169d871201b2ca7ff781d8c85e6abb6713ddfd4c51e28a8b66d03d432",
};

/** Binaries contained in every release archive. */
export const ARC_NODE_BINARIES = [
  "arc-node-execution",
  "arc-node-consensus",
  "arc-snapshots",
] as const;

/** The execution client — the only binary a local devchain runs. */
export const ARC_NODE_EXECUTION_BINARY = "arc-node-execution";

/**
 * Built-in chain spec name for the single-node development chain. Passed to
 * `--chain`; the genesis (chain id 1337, prefunded standard dev accounts,
 * native fiat token / Multicall3 / Permit2 / CREATE2 predeploys) is compiled
 * into the binary, so there is no genesis file to keep in sync.
 */
export const ARC_LOCALDEV_CHAIN = "arc-localdev";

/** Chain id of `arc-localdev`. Not Hardhat's 31337 — see ADR 0028 G6. */
export const ARC_LOCALDEV_CHAIN_ID = 1337;

/**
 * Maps the running platform to a release target triple, or explains why
 * there is no binary for it.
 *
 * Returns a discriminated result rather than throwing so callers can turn an
 * unsupported platform into actionable guidance (build from source, or use a
 * remote container) instead of a stack trace.
 */
export function resolveArcNodeTarget(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
):
  | { readonly ok: true; readonly target: string }
  | { readonly ok: false; readonly reason: string } {
  if (platform === "linux" && arch === "x64") {
    return { ok: true, target: "x86_64-unknown-linux-gnu" };
  }

  if (platform === "linux" && arch === "arm64") {
    return { ok: true, target: "aarch64-unknown-linux-gnu" };
  }

  if (platform === "darwin" && arch === "arm64") {
    return { ok: true, target: "aarch64-apple-darwin" };
  }

  if (platform === "darwin" && arch === "x64") {
    return {
      ok: false,
      reason:
        "Intel macOS has no published Arc node binary. Build arc-node from " +
        "source, or run the local stack in a remote container.",
    };
  }

  return {
    ok: false,
    reason: `No Arc node release target for platform ${platform}/${arch}.`,
  };
}

/** Release archive filename for a target triple. */
export function arcNodeArchiveName(target: string): string {
  return `arc-node-${ARC_NODE_VERSION}-${target}.tar.gz`;
}

/** Download URL for a target's release archive. */
export function arcNodeArchiveUrl(target: string): string {
  return (
    "https://github.com/circlefin/arc-node/releases/download/" +
    `${ARC_NODE_VERSION}/${arcNodeArchiveName(target)}`
  );
}
