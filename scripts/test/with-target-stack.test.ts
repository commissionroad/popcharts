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

const slotProbePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "support",
  "slotProbe.ts",
);

/**
 * Runs the slot probe as a real child process under `env` and returns what it
 * derived. Spawning is the point: the launcher's bug class is an override that
 * exists in the resolver but never reaches the child's environment.
 */
async function probeChildSlot(env: NodeJS.ProcessEnv): Promise<string> {
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", slotProbePath],
    { env, stdio: ["ignore", "pipe", "ignore"] },
  );

  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  const code = await new Promise<number | null>((resolve) => {
    child.once("exit", resolve);
  });
  assert.equal(code, 0, `slot probe exited with ${code}`);

  return stdout.trim();
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

test("the spawned child derives the targeted slot, not slot 0", async () => {
  // The launcher exports every *concrete* value its wrapped commands read
  // today, which masks a missing slot: a child that derives its own resources
  // through readSlotFromEnv would compute slot 0 while the launcher announced
  // slot 1 (ADR 0020). Composed exactly as main() does — inherited env first,
  // overrides last — and run through a real process boundary, because the
  // failure is an override that never reaches the child. The inherited slot is
  // pinned to a different value so a passing assertion cannot come from the
  // ambient environment of whichever stack runs this suite.
  const slot = await probeChildSlot({
    ...process.env,
    POPCHARTS_STACK_SLOT: "0",
    ...targetStackEnv(stack()),
  });
  assert.equal(slot, "1");
});

test("the slot probe falls back to slot 0 without the launcher's overrides", async () => {
  // Pins the contrast the test above rests on: absent POPCHARTS_STACK_SLOT the
  // child really does land on slot 0, so that assertion is load-bearing rather
  // than restating a default.
  const { POPCHARTS_STACK_SLOT: _inherited, ...ambient } = process.env;
  assert.equal(await probeChildSlot(ambient), "0");
});
