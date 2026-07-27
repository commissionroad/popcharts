import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildProtocolCommandEnv,
  resolveLocalChainE2eTarget,
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
