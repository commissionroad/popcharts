import { describeTargetStack } from "./resolveTargetStack.ts";
import type { StackDescriptor } from "./registry.ts";

/**
 * Error thrown when no running stack belongs to the calling worktree. Carries
 * the foreign stacks purely so the message can name what *is* running — they
 * are never a fallback target.
 */
export class OwnStackResolutionError extends Error {
  readonly foreignStacks: readonly StackDescriptor[];

  constructor(message: string, foreignStacks: readonly StackDescriptor[]) {
    super(message);
    this.name = "OwnStackResolutionError";
    this.foreignStacks = foreignStacks;
  }
}

/**
 * Resolves the running stack that belongs to `worktreePath`, and only that one.
 *
 * Deliberately distinct from {@link resolveTargetStack}, which answers "which
 * stack should this command act on?" and will happily settle on the single
 * running stack whatever worktree started it. That fallback is correct for a
 * read or a market-creation script and catastrophic for a control-plane call:
 * an agent worktree with no stack of its own would silently be handed the
 * primary checkout's, and `process-compose`'s unauthenticated `/project/stop`
 * would take down a devchain whose state exists only in memory. That has
 * happened twice.
 *
 * So there is no fallback here. A worktree with no running stack is an error
 * naming what is running instead, never a redirect onto it. Ownership is keyed
 * on the registry's `worktreePath`, which `resolveAndRegisterStack` writes from
 * the launching worktree's own `repoRoot` — the same value this caller derives,
 * so the comparison is exact rather than heuristic.
 */
export function resolveOwnStack(options: {
  readonly liveStacks: readonly StackDescriptor[];
  readonly worktreePath: string;
}): StackDescriptor {
  const { liveStacks, worktreePath } = options;
  const mine = liveStacks.filter(
    (descriptor) => descriptor.worktreePath === worktreePath,
  );

  if (mine.length === 1) {
    return mine[0]!;
  }

  if (mine.length > 1) {
    // One worktree launches one stack, so this means the registry holds stale
    // or duplicated descriptors. Refusing beats picking one at random.
    throw new OwnStackResolutionError(
      `Registry lists ${mine.length} running stacks for this worktree; ` +
        `refusing to guess. Check \`ls ~/.popcharts/stacks\` and stop the stale one.`,
      mine,
    );
  }

  const foreign = liveStacks.filter(
    (descriptor) => descriptor.worktreePath !== worktreePath,
  );
  const others =
    foreign.length === 0
      ? "No local dev stack is running anywhere."
      : `Running elsewhere (NOT yours — do not act on these):\n` +
        foreign.map((s) => `  - ${describeTargetStack(s)}`).join("\n");

  throw new OwnStackResolutionError(
    `No local dev stack is running for this worktree (${worktreePath}). ` +
      `Start one with \`just local-dev\`.\n${others}`,
    foreign,
  );
}
