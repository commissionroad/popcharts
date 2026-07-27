import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { describe, it } from "node:test";

import {
  buildProtocolCommandEnv,
  resolveLocalChainE2eTarget,
  runProtocolCommand,
  startHardhatNode,
  type ProcessSpawner,
} from "../run-local-chain-e2e.ts";
import { deriveStackResources } from "../shared/localStack/ports.ts";
import { parseRpcListenTarget } from "../shared/net/parseRpcListenTarget.ts";

describe("run-local-chain-e2e chain target", function () {
  it("derives the probe, node bind, and child env from the explicit slot", function () {
    const target = resolveLocalChainE2eTarget({ POPCHARTS_STACK_SLOT: "1" });

    assert.deepEqual(target.chainEnv, {
      POPCHARTS_LOCAL_RPC_URL: "http://127.0.0.1:8555",
      POPCHARTS_RPC_URL: "http://127.0.0.1:8555",
      RPC_HTTP_URL: "http://127.0.0.1:8555",
    });
    // Regression: `hardhat node` with no --port binds 8545 whatever the rest of
    // the run resolved, so the probe waited on a chain nothing had started.
    assert.deepEqual(target.hardhatNodeArgs, [
      "node",
      "--hostname",
      "127.0.0.1",
      "--port",
      "8555",
    ]);
    assert.equal(
      target.chainEnv.RPC_HTTP_URL,
      deriveStackResources(1).chainRpcHttpUrl,
    );
  });

  it("lets the explicit slot outrank a chain inherited from the shell", function () {
    const target = resolveLocalChainE2eTarget({
      POPCHARTS_STACK_SLOT: "2",
      POPCHARTS_LOCAL_RPC_URL: "http://127.0.0.1:8545",
      RPC_HTTP_URL: "http://127.0.0.1:8545",
    });

    assert.equal(
      target.chainEnv.POPCHARTS_LOCAL_RPC_URL,
      "http://127.0.0.1:8565",
    );
    assert.deepEqual(target.hardhatNodeArgs.slice(-2), ["--port", "8565"]);
  });

  it("follows an inherited chain when no slot is declared", function () {
    const target = resolveLocalChainE2eTarget({
      RPC_HTTP_URL: "http://127.0.0.1:8575",
    });

    assert.equal(
      target.chainEnv.POPCHARTS_LOCAL_RPC_URL,
      "http://127.0.0.1:8575",
    );
    assert.deepEqual(target.hardhatNodeArgs.slice(-2), ["--port", "8575"]);
  });

  it("ignores POPCHARTS_RPC_URL, which also names the arc testnet", function () {
    // protocol/hardhat.config.ts reads POPCHARTS_RPC_URL for the arcTestnet
    // network, so `.env.example`'s value rides in a developer's shell. Honoring
    // it here pointed the probe and the emitted manifests at a chain none of
    // the `--network localhost` deploys ever touched.
    const target = resolveLocalChainE2eTarget({
      POPCHARTS_RPC_URL: "https://rpc.example.test",
    });

    assert.deepEqual(target.chainEnv, {
      POPCHARTS_LOCAL_RPC_URL: "http://127.0.0.1:8545",
      POPCHARTS_RPC_URL: "http://127.0.0.1:8545",
      RPC_HTTP_URL: "http://127.0.0.1:8545",
    });
    assert.deepEqual(target.hardhatNodeArgs.slice(-2), ["--port", "8545"]);
  });

  it("falls back to slot 0 when nothing identifies a chain", function () {
    const target = resolveLocalChainE2eTarget({});

    assert.equal(target.chainEnv.RPC_HTTP_URL, "http://127.0.0.1:8545");
    assert.deepEqual(target.hardhatNodeArgs.slice(-2), ["--port", "8545"]);
  });
});

// Resolving the chain correctly is worthless if the value never reaches the
// spawned child — that gap *was* the bug. Three of the four protocol helpers
// are `hardhat run --network localhost`, which reads POPCHARTS_LOCAL_RPC_URL;
// the old script set only POPCHARTS_RPC_URL, so every deploy landed on :8545
// while the manifests it emitted claimed the resolved chain.
describe("run-local-chain-e2e spawned protocol env", function () {
  it("hands the spawned protocol helper the resolved chain, not slot 0's", function () {
    const { chainEnv } = resolveLocalChainE2eTarget({
      POPCHARTS_STACK_SLOT: "1",
    });
    const spawnEnv = buildProtocolCommandEnv({
      baseEnv: {
        POPCHARTS_LOCAL_RPC_URL: "http://127.0.0.1:8545",
        POPCHARTS_RPC_URL: "http://127.0.0.1:8545",
        RPC_HTTP_URL: "http://127.0.0.1:8545",
      },
      chainEnv,
      deploymentEnv: {
        POPCHARTS_PREGRAD_MANAGER_ADDRESS:
          "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      },
    });

    assert.equal(spawnEnv.POPCHARTS_LOCAL_RPC_URL, "http://127.0.0.1:8555");
    assert.equal(spawnEnv.POPCHARTS_RPC_URL, "http://127.0.0.1:8555");
    assert.equal(spawnEnv.RPC_HTTP_URL, "http://127.0.0.1:8555");
    assert.equal(
      spawnEnv.POPCHARTS_PREGRAD_MANAGER_ADDRESS,
      "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    );
  });

  it("keeps the chain pin unshadowable by per-deploy variables", function () {
    const { chainEnv } = resolveLocalChainE2eTarget({
      POPCHARTS_STACK_SLOT: "1",
    });
    const spawnEnv = buildProtocolCommandEnv({
      baseEnv: {},
      chainEnv,
      deploymentEnv: { POPCHARTS_RPC_URL: "http://127.0.0.1:8545" },
    });

    assert.equal(spawnEnv.POPCHARTS_RPC_URL, "http://127.0.0.1:8555");
  });
});

// The env builder above is only half the story: the defect was a correctly
// resolved chain that never reached the child. These observe the actual
// handoff, so dropping the `env` option or reverting to `process.env` at the
// spawn site fails here even though every assertion above would still pass.
describe("run-local-chain-e2e child-process handoff", function () {
  const slotOneChainEnv = () =>
    resolveLocalChainE2eTarget({ POPCHARTS_STACK_SLOT: "1" }).chainEnv;

  it("hands every protocol child the chain the run resolved", async function () {
    const calls: {
      args: readonly string[];
      command: string;
      env: NodeJS.ProcessEnv;
    }[] = [];

    await runProtocolCommand({
      args: ["--dir", "protocol", "local:deploy-venue"],
      baseEnv: { POPCHARTS_LOCAL_RPC_URL: "http://127.0.0.1:8545" },
      chainEnv: slotOneChainEnv(),
      command: "pnpm",
      execute: async (command, args, options) => {
        calls.push({ args, command, env: options.env ?? {} });
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.command, "pnpm");
    assert.deepEqual(calls[0]!.args, [
      "--dir",
      "protocol",
      "local:deploy-venue",
    ]);
    // POPCHARTS_LOCAL_RPC_URL is the one the `--network localhost` helpers
    // actually dial; it was the variable the old script never set.
    assert.equal(
      calls[0]!.env.POPCHARTS_LOCAL_RPC_URL,
      "http://127.0.0.1:8555",
    );
    assert.equal(calls[0]!.env.POPCHARTS_RPC_URL, "http://127.0.0.1:8555");
    assert.equal(calls[0]!.env.RPC_HTTP_URL, "http://127.0.0.1:8555");
  });

  it("never falls back to the ambient environment for a child's chain", async function () {
    let received: NodeJS.ProcessEnv | undefined;

    await runProtocolCommand({
      args: ["--dir", "protocol", "devchain:deploy"],
      chainEnv: slotOneChainEnv(),
      command: "pnpm",
      execute: async (_command, _args, options) => {
        received = options.env;
      },
    });

    assert.notEqual(received, undefined);
    assert.notEqual(received, process.env);
    assert.equal(received?.POPCHARTS_LOCAL_RPC_URL, "http://127.0.0.1:8555");
  });

  it("binds the chain node to the resolved port and hands it the same chain", function () {
    const { chainEnv, hardhatNodeArgs } = resolveLocalChainE2eTarget({
      POPCHARTS_STACK_SLOT: "1",
    });
    let spawned: Parameters<ProcessSpawner> | undefined;

    startHardhatNode({
      baseEnv: {},
      chainEnv,
      hardhatNodeArgs,
      spawnProcess: (...args) => {
        spawned = args;
        // The caller only attaches an exit listener, so a stub with `on` is
        // the whole contract this test needs from a ChildProcess.
        return { on: () => undefined } as unknown as ChildProcess;
      },
    });

    const [command, nodeArgs, options] = spawned ?? [];
    assert.match(String(command), /hardhat$/);
    assert.deepEqual(nodeArgs, [
      "node",
      "--hostname",
      "127.0.0.1",
      "--port",
      "8555",
    ]);
    assert.equal(options?.env.POPCHARTS_LOCAL_RPC_URL, "http://127.0.0.1:8555");
  });
});

// Dropping POPCHARTS_RPC_URL as a chain input is an observable change: it used
// to steer the probe and devchain:deploy (never the `--network localhost`
// deploys). A developer relying on it gets an error, not a silent move to
// slot 0 — but a shell carrying .env.example's remote arc URL is simply
// ignored, since a local chain e2e was never going to run against it.
describe("run-local-chain-e2e stranded POPCHARTS_RPC_URL", function () {
  it("rejects a lone local override that disagrees with the resolved chain", function () {
    assert.throws(
      () =>
        resolveLocalChainE2eTarget({
          POPCHARTS_RPC_URL: "http://127.0.0.1:8575",
        }),
      /POPCHARTS_LOCAL_RPC_URL/,
    );
  });

  it("ignores a remote override rather than blocking the run", function () {
    const target = resolveLocalChainE2eTarget({
      POPCHARTS_RPC_URL: "https://rpc.testnet.arc.network",
    });

    assert.equal(target.chainEnv.RPC_HTTP_URL, "http://127.0.0.1:8545");
  });

  it("accepts an override that agrees, or that another variable corroborates", function () {
    assert.equal(
      resolveLocalChainE2eTarget({ POPCHARTS_RPC_URL: "http://127.0.0.1:8545" })
        .chainEnv.RPC_HTTP_URL,
      "http://127.0.0.1:8545",
    );

    // with-target-stack exports all three together, so this must not throw.
    assert.equal(
      resolveLocalChainE2eTarget({
        POPCHARTS_LOCAL_RPC_URL: "http://127.0.0.1:8555",
        POPCHARTS_RPC_URL: "http://127.0.0.1:8555",
        RPC_HTTP_URL: "http://127.0.0.1:8555",
      }).chainEnv.RPC_HTTP_URL,
      "http://127.0.0.1:8555",
    );
  });
});

describe("parseRpcListenTarget", function () {
  it("splits a URL into the host and port a listener binds", function () {
    assert.deepEqual(parseRpcListenTarget("http://127.0.0.1:8555"), {
      hostname: "127.0.0.1",
      port: "8555",
    });
    assert.deepEqual(parseRpcListenTarget("http://localhost:3000"), {
      hostname: "localhost",
      port: "3000",
    });
  });

  it("reports the scheme default when the URL names no port", function () {
    assert.equal(parseRpcListenTarget("http://example.test").port, "80");
    assert.equal(parseRpcListenTarget("https://example.test").port, "443");
    assert.equal(parseRpcListenTarget("wss://example.test").port, "443");
  });

  it("throws rather than guessing a port to bind", function () {
    assert.throws(() => parseRpcListenTarget("not a url"), /not a url/);
  });
});
