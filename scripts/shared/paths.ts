import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the repository root, derived from this file's location. */
export const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/** Absolute path to the protocol workspace. */
export const protocolDir = resolve(repoRoot, "protocol");

/** Absolute path to the server workspace. */
export const serverDir = resolve(repoRoot, "server");

/** Absolute path to the app workspace. */
export const appDir = resolve(repoRoot, "app");
