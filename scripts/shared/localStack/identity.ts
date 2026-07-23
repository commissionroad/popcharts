import { basename } from "node:path";

import { assertValidSlot } from "./assertValidSlot.ts";

/**
 * Who a local dev stack belongs to. Drives slot assignment: humans default to
 * slot 0, agents start at slot 1 (ADR 0020).
 */
export type StackKind = "human" | "agent";

/**
 * Classifies a stack from its working directory: a cwd inside a
 * `.worktrees/` tree is an agent stack. Legacy harness-managed
 * `.claude/worktrees/` paths remain supported while those worktrees exist.
 * Everything else (the primary checkout) is a human stack. The cwd path is
 * the only signal by design (ADR 0020) — no env flag or heuristic beyond it.
 */
export function detectStackKind(cwd: string): StackKind {
  const segments = cwd.replaceAll("\\", "/").split("/");

  return segments.some(
    (segment, index) =>
      segment === ".worktrees" ||
      (segment === ".claude" && segments[index + 1] === "worktrees"),
  )
    ? "agent"
    : "human";
}

/**
 * Builds a stable, filesystem-safe registry id for a stack from its checkout's
 * leaf directory name and slot (e.g. `popcharts-slot0`,
 * `adr-0020-concurrent-local-stacks-slot1`). Used as the registry descriptor
 * filename, so it must stay stable across a stack's lifetime. Throws on a
 * negative or non-integer slot.
 */
export function deriveInstanceId(cwd: string, slot: number): string {
  assertValidSlot(slot);

  const sanitizedLeaf = basename(cwd)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${sanitizedLeaf || "stack"}-slot${slot}`;
}
