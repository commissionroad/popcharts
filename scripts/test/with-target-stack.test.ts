import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { StackDescriptor } from "../shared/localStack/registry.ts";
import {
  parseLauncherArgs,
  targetStackEnv,
} from "../with-target-stack.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const slotProbePath = join(testDir, "support", "slotProbe.ts");
const launcherPath = join(testDir, "..", "with-target-stack.ts");

/** Runs a TypeScript entry point to completion and returns its stdout. */
async function runNode(
  scriptPath: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; code: number | null }> {
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", scriptPath, ...args],
    { env, stdio: ["ignore", "pipe", "inherit"] },
  );

  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  const code = await new Promise<number | null>((resolve) => {
    child.once("exit", resolve);
  });

  return { stdout, code };
}

/**
 * The slot the probe derived, read out of a stdout that may also carry the
 * launcher's own banner. Asserting on exactly one `slot=` reading keeps a
 * silent no-output run from being mistaken for a passing one.
 */
function probedSlot(stdout: string): string {
  const readings = [...stdout.matchAll(/slot=(\d+)/g)].map((m) => m[1]!);
  assert.equal(
    readings.length,
    1,
    `expected exactly one slot reading, got ${JSON.stringify(stdout)}`,
  );
  return readings[0]!;
}

/**
 * Writes `descriptor` into a throwaway registry directory and returns the env
 * that points the launcher at it. Hermetic by construction: the launcher prunes
 * dead descriptors, so it must never be allowed to read (and delete from) the
 * developer's real `~/.popcharts/local-stacks`.
 */
function registryEnvFor(
  descriptor: StackDescriptor,
  registryDir: string,
): NodeJS.ProcessEnv {
  writeFileSync(
    join(registryDir, `${descriptor.instanceId}.json`),
    JSON.stringify(descriptor),
  );
  return { POPCHARTS_STACK_REGISTRY_DIR: registryDir };
}

function stack(overrides: Partial<StackDescriptor> = {}): StackDescriptor {
  return {
    instanceId: "feature-slot1",
    slot: 1,
    kind: "agent",
    worktreePath: "/w/feature",
    chainPort: 8555,
    chainId: 31337,
    apiPort: 3011,
    appPort: 3010,
    reviewPort: 3012,
    resolutionPort: 3014,
    pcAdminPort: 8081,
    dbName: "popcharts_1",
    envFilePath: "/nonexistent/.env.local-chain.1",
    deployAddressesPath: null,
    controlPid: 1001,
    startedAt: "2026-07-17T00:00:00.000Z",
    ...overrides,
  };
}

test("parseLauncherArgs splits --stack from the wrapped command", () => {
  const parsed = parseLauncherArgs([
    "--stack",
    "1",
    "--",
    "pnpm",
    "--dir",
    "protocol",
    "run",
    "local:deploy-venue",
  ]);
  assert.equal(parsed.stackToken, "1");
  assert.deepEqual(parsed.command, [
    "pnpm",
    "--dir",
    "protocol",
    "run",
    "local:deploy-venue",
  ]);
});

test("parseLauncherArgs accepts --stack=<token>", () => {
  const parsed = parseLauncherArgs(["--stack=primary-slot0", "--", "bun", "x"]);
  assert.equal(parsed.stackToken, "primary-slot0");
  assert.deepEqual(parsed.command, ["bun", "x"]);
});

test("parseLauncherArgs throws when no command follows --", () => {
  assert.throws(() => parseLauncherArgs(["--stack", "1"]), /no command to run/);
  assert.throws(() => parseLauncherArgs(["--stack", "1", "--"]), /no command to run/);
});

test("targetStackEnv exports the slot's chain/api aliases", () => {
  const env = targetStackEnv(stack());
  assert.equal(env.POPCHARTS_STACK_SLOT, "1");
  assert.equal(env.POPCHARTS_LOCAL_RPC_URL, "http://127.0.0.1:8555");
  assert.equal(env.POPCHARTS_RPC_URL, "http://127.0.0.1:8555");
  assert.equal(env.RPC_HTTP_URL, "http://127.0.0.1:8555");
  assert.equal(env.RPC_WSS_URL, "ws://127.0.0.1:8555");
  assert.equal(env.LOCAL_API_PORT, "3011");
  assert.equal(env.POPCHARTS_LOCAL_CHAIN_ENV_FILE, "/nonexistent/.env.local-chain.1");
});

test("targetStackEnv merges the slot's generated env file when present", () => {
  const dir = mkdtempSync(join(tmpdir(), "with-target-stack-"));
  const envFilePath = join(dir, ".env.local-chain.1");
  writeFileSync(
    envFilePath,
    "DATABASE_URL=postgresql://postgres:postgres@localhost:5433/popcharts_1\n" +
      "PREGRAD_MANAGER_ADDRESS=0xabc\n" +
      "RPC_HTTP_URL=http://127.0.0.1:9999\n",
  );
  try {
    const env = targetStackEnv(stack({ envFilePath }));
    assert.equal(
      env.DATABASE_URL,
      "postgresql://postgres:postgres@localhost:5433/popcharts_1",
    );
    assert.equal(env.PREGRAD_MANAGER_ADDRESS, "0xabc");
    // The alias still wins for the RPC url even though the file may carry one.
    assert.equal(env.RPC_HTTP_URL, "http://127.0.0.1:8555");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the command the launcher spawns derives the targeted slot, not slot 0", async () => {
  // Drives the real launcher end to end — its own resolution, its own spawn —
  // rather than re-composing the env the way main() does, because the bug class
  // is an override that exists in the resolver and never reaches the child. A
  // test that built the env itself would stay green if the handoff at the spawn
  // call site were broken.
  //
  // The launcher exports every *concrete* value its wrapped commands read
  // today, which is what masks a missing slot: a child deriving its own
  // resources through readSlotFromEnv computes slot 0 while the launcher
  // announces slot 1 (ADR 0020). The inherited slot is pinned to a different
  // value so a passing assertion cannot come from the ambient environment of
  // whichever stack runs this suite.
  const registryDir = mkdtempSync(join(tmpdir(), "with-target-stack-registry-"));
  try {
    // A live control pid inside the startup grace period keeps the descriptor
    // alive without a chain answering on its port (registry.ts).
    const target = stack({
      controlPid: process.pid,
      startedAt: new Date().toISOString(),
    });
    const { stdout, code } = await runNode(
      launcherPath,
      ["--stack", "1", "--", process.execPath, "--experimental-strip-types", slotProbePath],
      {
        ...process.env,
        POPCHARTS_STACK_SLOT: "0",
        ...registryEnvFor(target, registryDir),
      },
    );

    assert.equal(code, 0, `launcher exited with ${code}`);
    assert.match(stdout, /targeting slot 1/);
    assert.equal(probedSlot(stdout), "1");
  } finally {
    rmSync(registryDir, { recursive: true, force: true });
  }
});

test("the slot probe falls back to slot 0 without the launcher's overrides", async () => {
  // Pins the contrast the test above rests on: absent POPCHARTS_STACK_SLOT the
  // child really does land on slot 0, so that assertion is load-bearing rather
  // than restating a default.
  const { POPCHARTS_STACK_SLOT: _inherited, ...ambient } = process.env;
  const { stdout, code } = await runNode(slotProbePath, [], ambient);
  assert.equal(code, 0, `slot probe exited with ${code}`);
  assert.equal(probedSlot(stdout), "0");
});
