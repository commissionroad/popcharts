import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { protocolDir, repoRoot } from "../shared/paths.ts";

/**
 * Guards the wiring between the three layers an operator command passes
 * through: the `justfile` recipe, the root `package.json` script it invokes,
 * and the protocol-workspace script that script delegates to.
 *
 * Both invariants here failed silently in the past. `just cancel-market` called
 * a root script that did not exist (the recipe simply errored), and the natural
 * one-line repair — pointing the root script straight at the protocol script —
 * would have sent an operator kill switch to slot 0's chain from any agent
 * worktree (ADR 0020). Neither layer is type-checked, so assert the wiring.
 */

type PackageScripts = Record<string, string>;

function readScripts(packageJsonPath: string): PackageScripts {
  const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const scripts = (parsed as { scripts?: PackageScripts }).scripts;
  assert.ok(scripts, `${packageJsonPath} has no "scripts" block`);
  return scripts;
}

const rootScripts = readScripts(resolve(repoRoot, "package.json"));
const protocolScripts = readScripts(resolve(protocolDir, "package.json"));
const justfile = readFileSync(resolve(repoRoot, "justfile"), "utf8");

test("every `pnpm run` target a justfile recipe invokes exists in the root package.json", function () {
  // Recipe bodies call the root scripts as `pnpm run <name>`, optionally with
  // trailing `-- {{args}}`; capture just the script name.
  const invoked = [...justfile.matchAll(/\bpnpm run ([\w:-]+)/g)].map(
    (match) => match[1]!,
  );

  assert.ok(invoked.length > 0, "expected the justfile to invoke root scripts");

  const missing = invoked.filter((name) => !(name in rootScripts));
  assert.deepEqual(
    missing,
    [],
    `justfile recipes invoke root scripts that do not exist: ${missing.join(", ")}`,
  );
});

test("root scripts delegating to a `--network localhost` protocol script route through with-target-stack", function () {
  // A protocol script pinned to `--network localhost` takes its RPC URL from
  // POPCHARTS_LOCAL_RPC_URL and falls back to slot 0's :8545, so a root wrapper
  // that spawns it directly targets the *human* stack's chain no matter which
  // stack the caller meant. with-target-stack.ts exports the chosen slot's
  // chain env before exec'ing, which is what makes the delegation slot-correct.
  const offenders: string[] = [];

  for (const [rootName, rootCommand] of Object.entries(rootScripts)) {
    const delegation = /pnpm --dir protocol run ([\w:-]+)/.exec(rootCommand);
    if (delegation === null) {
      continue;
    }
    const protocolCommand = protocolScripts[delegation[1]!];
    assert.ok(
      protocolCommand,
      `root script "${rootName}" delegates to protocol script "${delegation[1]}", which does not exist`,
    );
    if (
      protocolCommand.includes("--network localhost") &&
      !rootCommand.includes("with-target-stack.ts")
    ) {
      offenders.push(rootName);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `root scripts spawn a localhost-pinned protocol script without stack routing: ${offenders.join(", ")}`,
  );
});
