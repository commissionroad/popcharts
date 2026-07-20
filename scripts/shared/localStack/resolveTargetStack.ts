import { type StackDescriptor } from "./registry.ts";

/**
 * Error thrown when a stack-targeting script cannot unambiguously choose which
 * running local dev stack to act on. Carries the live descriptors so a caller
 * can render a selection prompt or a helpful message.
 */
export class TargetStackResolutionError extends Error {
  readonly liveStacks: readonly StackDescriptor[];
  constructor(message: string, liveStacks: readonly StackDescriptor[]) {
    super(message);
    this.name = "TargetStackResolutionError";
    this.liveStacks = liveStacks;
  }
}

/**
 * Formats a live stack descriptor as a one-line human choice, e.g.
 * `slot 1 (agent) chain:8555 api:3011 db:popcharts_1 — <worktree>`. Used in the
 * "which stack?" prompt and in ambiguity error messages.
 */
export function describeTargetStack(descriptor: StackDescriptor): string {
  return (
    `slot ${descriptor.slot} (${descriptor.kind}) ` +
    `chain:${descriptor.chainPort} api:${descriptor.apiPort} ` +
    `db:${descriptor.dbName} — ${descriptor.worktreePath}`
  );
}

/**
 * Matches an explicit `--stack` / `POPCHARTS_STACK` selector against the live
 * stacks. A selector that is all digits matches a slot number; otherwise it
 * matches an instance id (exact, then unique prefix). Returns the single match
 * or throws {@link TargetStackResolutionError} when zero or many match.
 */
export function selectStackByToken(
  token: string,
  liveStacks: readonly StackDescriptor[],
): StackDescriptor {
  const trimmed = token.trim();
  const bySlot = /^[0-9]+$/.test(trimmed)
    ? liveStacks.filter((s) => s.slot === Number(trimmed))
    : [];
  const byId =
    bySlot.length > 0
      ? []
      : liveStacks.filter(
          (s) => s.instanceId === trimmed || s.instanceId.startsWith(trimmed),
        );
  const matches = bySlot.length > 0 ? bySlot : byId;
  if (matches.length === 1) {
    return matches[0]!;
  }
  const detail =
    matches.length === 0 ? "matched no running stack" : "matched several stacks";
  throw new TargetStackResolutionError(
    `--stack/POPCHARTS_STACK "${token}" ${detail}.`,
    liveStacks,
  );
}

/**
 * Resolves which running local dev stack a targeting script (e.g.
 * `local-create-market`) should act on, given the already-pruned live
 * descriptors from the home-dir registry (ADR 0020). The caller prunes (so
 * this stays pure and testable). An explicit `token` (`--stack` value or
 * `POPCHARTS_STACK`) always wins. Otherwise: zero live stacks is an error; one
 * is used directly; several require disambiguation — `chooseStack` is invoked
 * when provided (an interactive prompt on a TTY), else a
 * {@link TargetStackResolutionError} listing the candidates is thrown so the
 * caller can tell the user to pass `--stack`.
 */
export async function resolveTargetStack(options: {
  readonly liveStacks: readonly StackDescriptor[];
  readonly token?: string | undefined;
  readonly chooseStack?:
    | ((stacks: readonly StackDescriptor[]) => Promise<StackDescriptor>)
    | undefined;
}): Promise<StackDescriptor> {
  const { liveStacks } = options;

  if (options.token !== undefined && options.token.trim() !== "") {
    return selectStackByToken(options.token, liveStacks);
  }
  if (liveStacks.length === 0) {
    throw new TargetStackResolutionError(
      "No local dev stack is running. Start one with `just local-dev`.",
      liveStacks,
    );
  }
  if (liveStacks.length === 1) {
    return liveStacks[0]!;
  }
  if (options.chooseStack !== undefined) {
    return options.chooseStack(liveStacks);
  }
  const list = liveStacks.map((s) => `  - ${describeTargetStack(s)}`).join("\n");
  throw new TargetStackResolutionError(
    `Multiple local dev stacks are running; choose one with --stack <slot|id> ` +
      `or POPCHARTS_STACK:\n${list}`,
    liveStacks,
  );
}
