import { basename } from "node:path";

export type StackKind = "human" | "agent";

export function detectStackKind(cwd: string): StackKind {
  const segments = cwd.replaceAll("\\", "/").split("/");

  return segments.some(
    (segment, index) =>
      segment === ".claude" && segments[index + 1] === "worktrees",
  )
    ? "agent"
    : "human";
}

export function deriveInstanceId(cwd: string, slot: number): string {
  if (!Number.isInteger(slot) || slot < 0) {
    throw new Error(`Stack slot must be a non-negative integer; received ${slot}.`);
  }

  const sanitizedLeaf = basename(cwd)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${sanitizedLeaf || "stack"}-slot${slot}`;
}
