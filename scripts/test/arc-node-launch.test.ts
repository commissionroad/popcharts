import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildArcNodeLaunchPlan, resolveLaunchSlot } from "../arc-node.ts";
import { arcChainLogDir } from "../shared/chain/arcNodePaths.ts";
import { deriveStackResources } from "../shared/localStack/ports.ts";

/**
 * The launcher's half of the slot contract.
 *
 * The port derivation is proved next door, in local-stack-ports.test.ts. What
 * that cannot prove is that the launcher *uses* it: a `--port` flag silently
 * dropped from the argument list leaves reth on its default, and every slot
 * then binds 30303 or 8551 while looking correctly configured in every log
 * line. So these tests read the arguments the child would actually receive.
 */

function flags(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

describe("arc node launch slot resolution", () => {
  it("takes the slot from the inherited environment by default", () => {
    assert.equal(
      resolveLaunchSlot(flags({}), { POPCHARTS_STACK_SLOT: "3" }),
      3,
    );
    assert.equal(resolveLaunchSlot(flags({}), {}), 0);
  });

  it("prefers an explicit slot over the inherited one", () => {
    assert.equal(
      resolveLaunchSlot(flags({ slot: "2" }), { POPCHARTS_STACK_SLOT: "3" }),
      2,
    );
  });

  it("resolves a chain port back to its slot rather than using it directly", () => {
    // Honouring the port and deriving everything else from slot 0 is the exact
    // defect this phase fixes, so a port is only ever an alias for a slot.
    assert.equal(resolveLaunchSlot(flags({ port: "8555" }), {}), 1);
    assert.equal(resolveLaunchSlot(flags({ port: "8545" }), {}), 0);
  });

  it("rejects a port that belongs to no slot", () => {
    assert.throws(
      () => resolveLaunchSlot(flags({ port: "8550" }), {}),
      /not a stack slot's chain port/,
    );
  });

  it("rejects a slot and port that name different stacks", () => {
    assert.throws(
      () => resolveLaunchSlot(flags({ port: "8565", slot: "1" }), {}),
      /different stacks/,
    );
    assert.equal(resolveLaunchSlot(flags({ port: "8555", slot: "1" }), {}), 1);
  });

  it("rejects a malformed slot with the shared slot message", () => {
    assert.throws(
      () => resolveLaunchSlot(flags({ slot: "-1" }), {}),
      /non-negative integer/,
    );
    assert.throws(
      () => resolveLaunchSlot(flags({ slot: "one" }), {}),
      /non-negative integer/,
    );
  });
});

describe("arc node launch plan", () => {
  it("passes every per-slot resource to the node", () => {
    const slot = 2;
    const resources = deriveStackResources(slot);
    const plan = buildArcNodeLaunchPlan(slot, "200ms");

    assert.deepEqual(
      {
        authrpc: flagValue(plan.args, "authrpc.port"),
        datadir: flagValue(plan.args, "datadir"),
        http: flagValue(plan.args, "http.port"),
        logDir: flagValue(plan.args, "log.file.directory"),
        metrics: flagValue(plan.args, "metrics"),
        p2p: flagValue(plan.args, "port"),
      },
      {
        authrpc: String(resources.chainAuthRpcPort),
        datadir: resources.chainDataDir,
        http: String(resources.chainPort),
        logDir: arcChainLogDir(slot),
        metrics: String(resources.chainMetricsPort),
        p2p: String(resources.chainP2pPort),
      },
    );
  });

  it("keeps two slots' launches free of any shared resource", () => {
    const first = buildArcNodeLaunchPlan(0, "200ms");
    const second = buildArcNodeLaunchPlan(1, "200ms");

    for (const name of [
      "authrpc.port",
      "datadir",
      "http.port",
      "ipcpath",
      "log.file.directory",
      "metrics",
      "port",
    ]) {
      assert.notEqual(
        flagValue(first.args, name),
        flagValue(second.args, name),
        `--${name} is shared by slot 0 and slot 1`,
      );
    }
  });

  it("keeps the chain spec, block time, and fee cap out of the slot model", () => {
    // These are properties of the chain, not of the slot: every slot runs the
    // same arc-localdev genesis at the same cadence. A test that let them
    // vary per slot would be describing a different chain per stack.
    const plan = buildArcNodeLaunchPlan(1, "50ms");

    assert.equal(flagValue(plan.args, "chain"), "arc-localdev");
    assert.equal(flagValue(plan.args, "dev.block-time"), "50ms");
    assert.equal(flagValue(plan.args, "rpc.txfeecap"), "1000");
    assert.ok(plan.args.includes("--dev"));
    assert.ok(plan.args.includes("--http"));
  });
});
