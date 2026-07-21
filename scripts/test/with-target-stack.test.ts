import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { StackDescriptor } from "../shared/localStack/registry.ts";
import {
  parseLauncherArgs,
  targetStackEnv,
} from "../with-target-stack.ts";

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
