import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  ARC_NODE_ARCHIVE_SHA256,
  ARC_NODE_EXECUTION_BINARY,
  ARC_NODE_VERSION,
  arcNodeArchiveName,
  arcNodeArchiveUrl,
  resolveArcNodeTarget,
} from "./arcNodeRelease.ts";
import { repoRoot } from "../paths.ts";

/**
 * Fetches the pinned Arc node release into the repository's ignored
 * `.local-dev/` tree and verifies it against the checksum published
 * alongside it.
 *
 * Everything lands inside the repository on purpose. `arcup` installs to
 * `$HOME/.arc` and arc-node writes tracing logs to `~/.cache/reth` by
 * default; AGENTS.md forbids mutating files outside this repository without
 * approval, so we bypass `arcup` entirely and pin every path ourselves.
 * See ADR 0028 G9.
 */

/** Install root for all Arc node versions. */
export function arcNodeInstallRoot(): string {
  return path.join(repoRoot, ".local-dev", "arc-node");
}

/** Install directory for the pinned version. */
export function arcNodeVersionDir(): string {
  return path.join(arcNodeInstallRoot(), ARC_NODE_VERSION);
}

/** Path the execution binary is installed to. */
export function arcNodeExecutablePath(): string {
  return path.join(arcNodeVersionDir(), ARC_NODE_EXECUTION_BINARY);
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function run(
  command: string,
  args: readonly string[],
): Promise<{ code: number; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

/**
 * Ensures the pinned execution binary exists locally, downloading and
 * verifying it if not, and returns its path.
 *
 * Idempotent: an already-installed binary is returned without touching the
 * network. Pass `force` to re-download over an existing install.
 */
export async function ensureArcNode(
  options: { readonly force?: boolean } = {},
): Promise<string> {
  const executable = arcNodeExecutablePath();

  if (!options.force && fs.existsSync(executable)) {
    return executable;
  }

  const resolved = resolveArcNodeTarget();
  if (!resolved.ok) {
    throw new Error(
      `Cannot install Arc node ${ARC_NODE_VERSION}: ${resolved.reason}`,
    );
  }

  const { target } = resolved;
  const expected = ARC_NODE_ARCHIVE_SHA256[target];
  if (expected === undefined) {
    throw new Error(
      `No pinned checksum for Arc node target ${target}. Add it to ` +
        "ARC_NODE_ARCHIVE_SHA256 in the same change that bumps the version.",
    );
  }

  const versionDir = arcNodeVersionDir();
  fs.mkdirSync(versionDir, { recursive: true });
  const archivePath = path.join(versionDir, arcNodeArchiveName(target));

  // `--fail` is load-bearing, not defensive: without it curl writes the
  // server's error body to the output path, so a missing release asset
  // becomes a nine-byte file named `.tar.gz` that only fails later, at tar,
  // with an error that points nowhere near the real cause. That is exactly
  // how v0.6.0's total absence of binaries stayed hidden (ADR 0028 G13).
  const download = await run("curl", [
    "--fail",
    "--location",
    "--silent",
    "--show-error",
    "--retry",
    "3",
    "--retry-delay",
    "2",
    "--connect-timeout",
    "15",
    "--output",
    archivePath,
    arcNodeArchiveUrl(target),
  ]);

  if (download.code !== 0) {
    fs.rmSync(archivePath, { force: true });
    throw new Error(
      `Failed to download ${arcNodeArchiveUrl(target)}: ${download.stderr.trim()}`,
    );
  }

  const actual = sha256File(archivePath);
  if (actual !== expected) {
    // Remove the archive before throwing so a corrupted or substituted
    // download is never left where a later run could treat it as cached.
    fs.rmSync(archivePath, { force: true });
    throw new Error(
      `Checksum mismatch for ${arcNodeArchiveName(target)}:\n` +
        `  expected ${expected}\n  actual   ${actual}`,
    );
  }

  const extract = await run("tar", ["xzf", archivePath, "-C", versionDir]);
  if (extract.code !== 0) {
    throw new Error(`Failed to extract ${archivePath}: ${extract.stderr.trim()}`);
  }

  fs.rmSync(archivePath, { force: true });

  if (!fs.existsSync(executable)) {
    throw new Error(
      `Archive ${arcNodeArchiveName(target)} did not contain ` +
        `${ARC_NODE_EXECUTION_BINARY}.`,
    );
  }

  fs.chmodSync(executable, 0o755);

  return executable;
}
