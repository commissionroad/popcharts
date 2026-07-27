import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { describe, it } from "node:test";

import { runLocalChainE2e } from "../run-local-chain-e2e.ts";
import { DEMO_MARKET_SYMBOL } from "../shared/deployments/demoMarket.ts";
import { deriveStackResources } from "../shared/localStack/ports.ts";

/**
 * The whole run, driven end to end against injected effects.
 *
 * The seam tests next door prove the resolver and the env builders are right;
 * they cannot prove the run *uses* them. Both defects this script has had were
 * at these call sites — a `hardhat node` spawned without the resolved port, a
 * Playwright child handed a hardcoded `http://localhost:3000` — and a suite
 * that stops at the builders stays green through either. So these tests call
 * the run itself and assert on what every child actually receives.
 */

const SLOT = 1;
const resources = deriveStackResources(SLOT);
const RPC_URL = resources.chainRpcHttpUrl;
const COLLATERAL = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const PREGRAD_MANAGER = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

const manifest = {
  contracts: {
    collateral: { address: COLLATERAL },
    pregradManager: { address: PREGRAD_MANAGER },
  },
};

type RecordedCall = {
  args: readonly string[];
  command: string;
  env: NodeJS.ProcessEnv;
};

/**
 * A stand-in for the chain node. `stopHardhatNode` reads `killed`, sends
 * SIGTERM and then waits for `exit`, so the stub has to actually emit it —
 * otherwise teardown sits on its 3s escape timer in every test.
 */
function stubChainNode(signals: string[]): ChildProcess {
  const node = {
    killed: false,
    kill: (signal: string) => {
      signals.push(signal);
      return true;
    },
    on: () => node,
    once: (event: string, listener: () => void) => {
      if (event === "exit") {
        setImmediate(listener);
      }
      return node;
    },
  };

  return node as unknown as ChildProcess;
}

describe("run-local-chain-e2e whole run", function () {
  it("drives every child against the slot the run resolved", async function () {
    const calls: RecordedCall[] = [];

    await runLocalChainE2e({
      env: { POPCHARTS_STACK_SLOT: String(SLOT) },
      execute: async (command, args, options) => {
        calls.push({ args, command, env: options.env ?? {} });
      },
      log: () => undefined,
      probeRpc: async () => true,
      readManifest: () => manifest,
      spawnProcess: () => {
        throw new Error("a chain already answers; nothing should be spawned");
      },
    });

    assert.deepEqual(
      calls.map((call) => `${call.command} ${call.args.join(" ")}`),
      [
        "pnpm --dir protocol devchain:deploy",
        "pnpm --dir protocol local:deploy-venue",
        "pnpm --dir protocol local:deploy-postgrad",
        "pnpm --dir protocol local:create-complete-set-market",
        "pnpm --dir app test:e2e:chain",
      ],
    );

    // Every child, not just the ones a reviewer would think to check: the
    // `--network localhost` deploys read POPCHARTS_LOCAL_RPC_URL and the
    // scripts' own viem clients read POPCHARTS_RPC_URL, and both default to
    // slot 0 when a call site forgets them.
    for (const call of calls) {
      assert.equal(call.env.POPCHARTS_LOCAL_RPC_URL, RPC_URL);
      assert.equal(call.env.POPCHARTS_RPC_URL, RPC_URL);
      assert.equal(call.env.RPC_HTTP_URL, RPC_URL);
    }
  });

  it("aims the browser suite at this slot's app, not a hardcoded 3000", async function () {
    const calls: RecordedCall[] = [];

    await runLocalChainE2e({
      env: { POPCHARTS_STACK_SLOT: String(SLOT) },
      execute: async (command, args, options) => {
        calls.push({ args, command, env: options.env ?? {} });
      },
      log: () => undefined,
      probeRpc: async () => true,
      readManifest: () => manifest,
    });

    const suite = calls.at(-1);

    assert.deepEqual(suite?.args, ["--dir", "app", "test:e2e:chain"]);
    assert.equal(suite?.env.PLAYWRIGHT_APP_PORT, String(resources.appPort));
    assert.equal(
      suite?.env.PLAYWRIGHT_BASE_URL,
      `http://localhost:${resources.appPort}`,
    );
    assert.equal(suite?.env.POPCHARTS_E2E_CHAIN, "true");
  });

  it("carries the deployed addresses forward to the children that need them", async function () {
    const calls: RecordedCall[] = [];

    await runLocalChainE2e({
      env: { POPCHARTS_STACK_SLOT: String(SLOT) },
      execute: async (command, args, options) => {
        calls.push({ args, command, env: options.env ?? {} });
      },
      log: () => undefined,
      probeRpc: async () => true,
      readManifest: () => manifest,
    });

    const postgrad = calls[2];
    const demoMarket = calls[3];

    assert.equal(
      postgrad?.env.POPCHARTS_PREGRAD_MANAGER_ADDRESS,
      PREGRAD_MANAGER,
    );
    assert.equal(demoMarket?.env.POPCHARTS_COLLATERAL_ADDRESS, COLLATERAL);
    assert.equal(demoMarket?.env.POPCHARTS_MARKET_SYMBOL, DEMO_MARKET_SYMBOL);
  });

  it("starts the chain on the resolved port when nothing answers", async function () {
    const signals: string[] = [];
    let spawned: { args: readonly string[]; env: NodeJS.ProcessEnv } | undefined;
    let probes = 0;

    await runLocalChainE2e({
      env: { POPCHARTS_STACK_SLOT: String(SLOT) },
      execute: async () => undefined,
      log: () => undefined,
      // Nothing is listening at first; the node this run starts answers the
      // readiness poll that follows.
      probeRpc: async () => {
        probes += 1;
        return probes > 1;
      },
      readManifest: () => manifest,
      spawnProcess: (_command, args, options) => {
        spawned = { args, env: options.env };
        return stubChainNode(signals);
      },
    });

    assert.deepEqual(spawned?.args, [
      "node",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(resources.chainPort),
    ]);
    assert.equal(spawned?.env.POPCHARTS_LOCAL_RPC_URL, RPC_URL);
    // The node this run started is its own to stop, however the run ends.
    assert.deepEqual(signals, ["SIGTERM"]);
  });

  it("stops a chain it started even when a child fails", async function () {
    const signals: string[] = [];
    let probes = 0;

    await assert.rejects(
      runLocalChainE2e({
        env: { POPCHARTS_STACK_SLOT: String(SLOT) },
        execute: async () => {
          throw new Error("devchain:deploy failed");
        },
        log: () => undefined,
        probeRpc: async () => {
          probes += 1;
          return probes > 1;
        },
        readManifest: () => manifest,
        spawnProcess: () => stubChainNode(signals),
      }),
      /devchain:deploy failed/,
    );

    assert.deepEqual(signals, ["SIGTERM"]);
  });

  it("leaves a chain it did not start running", async function () {
    const signals: string[] = [];

    await runLocalChainE2e({
      env: { POPCHARTS_STACK_SLOT: String(SLOT) },
      execute: async () => undefined,
      log: () => undefined,
      probeRpc: async () => true,
      readManifest: () => manifest,
      spawnProcess: () => stubChainNode(signals),
    });

    assert.deepEqual(signals, []);
  });
});
