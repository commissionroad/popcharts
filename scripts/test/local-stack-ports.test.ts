import assert from "node:assert/strict";
import { test } from "node:test";

import {
  arcChainDataDir,
  arcChainInstanceDir,
} from "../shared/chain/arcNodePaths.ts";
import { deriveArcNodePorts } from "../shared/chain/arcNodePorts.ts";
import {
  localChainEnvFile,
  localChainEnvFileForSlot,
  localDevIndexerHealthFile,
  localDevIndexerHealthFileForSlot,
} from "../shared/env/localDevEnvFiles.ts";
import {
  BASE_API_PORT,
  BASE_APP_PORT,
  BASE_CHAIN_ID,
  BASE_CHAIN_PORT,
  BASE_DATABASE_NAME,
  BASE_PC_ADMIN_PORT,
  BASE_RESOLUTION_PORT,
  BASE_REVIEW_PORT,
  SLOT_PORT_STRIDE,
  deriveStackResources,
  slotForAppPort,
  slotForChainPort,
  slotForControlPort,
} from "../shared/localStack/ports.ts";

test("slot 0 reproduces every legacy local stack resource", function () {
  assert.deepEqual(deriveStackResources(0), {
    slot: 0,
    chainPort: 8545,
    chainAuthRpcPort: 8551,
    chainMetricsPort: 9001,
    chainP2pPort: 30303,
    chainDataDir: arcChainDataDir(0),
    chainId: 31337,
    apiPort: 3001,
    appPort: 3000,
    reviewPort: 3002,
    resolutionPort: 3004,
    pcAdminPort: 8080,
    dbName: "popcharts",
    chainRpcHttpUrl: "http://127.0.0.1:8545",
    chainRpcWssUrl: "ws://127.0.0.1:8545",
    envFilePath: localChainEnvFile,
    indexerHealthFilePath: localDevIndexerHealthFile,
  });
});

test("slots 1 and 2 apply the documented offsets", function () {
  assert.deepEqual(deriveStackResources(1), {
    slot: 1,
    chainPort: 8555,
    chainAuthRpcPort: 8561,
    chainMetricsPort: 9011,
    chainP2pPort: 30313,
    chainDataDir: arcChainDataDir(1),
    chainId: 31337,
    apiPort: 3011,
    appPort: 3010,
    reviewPort: 3012,
    resolutionPort: 3014,
    pcAdminPort: 8090,
    dbName: "popcharts_1",
    chainRpcHttpUrl: "http://127.0.0.1:8555",
    chainRpcWssUrl: "ws://127.0.0.1:8555",
    envFilePath: `${localChainEnvFile}.1`,
    indexerHealthFilePath: `${localDevIndexerHealthFile}.1`,
  });
  assert.deepEqual(deriveStackResources(2), {
    slot: 2,
    chainPort: 8565,
    chainAuthRpcPort: 8571,
    chainMetricsPort: 9021,
    chainP2pPort: 30323,
    chainDataDir: arcChainDataDir(2),
    chainId: 31337,
    apiPort: 3021,
    appPort: 3020,
    reviewPort: 3022,
    resolutionPort: 3024,
    pcAdminPort: 8100,
    dbName: "popcharts_2",
    chainRpcHttpUrl: "http://127.0.0.1:8565",
    chainRpcWssUrl: "ws://127.0.0.1:8565",
    envFilePath: `${localChainEnvFile}.2`,
    indexerHealthFilePath: `${localDevIndexerHealthFile}.2`,
  });
});

test("resource bases and stride are exported as the source of truth", function () {
  assert.deepEqual(
    {
      BASE_API_PORT,
      BASE_APP_PORT,
      BASE_CHAIN_ID,
      BASE_CHAIN_PORT,
      BASE_DATABASE_NAME,
      BASE_PC_ADMIN_PORT,
      BASE_RESOLUTION_PORT,
      BASE_REVIEW_PORT,
      SLOT_PORT_STRIDE,
    },
    {
      BASE_API_PORT: 3001,
      BASE_APP_PORT: 3000,
      BASE_CHAIN_ID: 31337,
      BASE_CHAIN_PORT: 8545,
      BASE_DATABASE_NAME: "popcharts",
      BASE_PC_ADMIN_PORT: 8080,
      BASE_RESOLUTION_PORT: 3004,
      BASE_REVIEW_PORT: 3002,
      SLOT_PORT_STRIDE: 10,
    },
  );
});

test("resource derivation rejects negative and non-integer slots", function () {
  assert.throws(() => deriveStackResources(-1), /non-negative integer/);
  assert.throws(() => deriveStackResources(1.5), /non-negative integer/);
  assert.throws(() => deriveStackResources(Number.NaN), /non-negative integer/);
});

test("a chain or app port maps back to the slot that owns it", function () {
  for (const slot of [0, 1, 2, 7]) {
    const resources = deriveStackResources(slot);
    assert.equal(slotForChainPort(resources.chainPort), slot);
    assert.equal(slotForAppPort(resources.appPort), slot);
  }
});

test("a port no slot owns maps to no slot", function () {
  // Between two slots, below the base, and not a port number at all. Answering
  // with a slot here would name a stack that does not own the port.
  assert.equal(slotForChainPort(8550), undefined);
  assert.equal(slotForChainPort(8544), undefined);
  assert.equal(slotForChainPort(3000), undefined);
  assert.equal(slotForChainPort(8545.5), undefined);
  assert.equal(slotForChainPort(Number.NaN), undefined);
  assert.equal(slotForAppPort(3005), undefined);
  assert.equal(slotForAppPort(2999), undefined);
  assert.equal(slotForAppPort(8545), undefined);
});

test("the app-port grid never claims another resource's port", function () {
  // The stride is what keeps the bases apart: API 3001, review 3002 and
  // resolution 3004 must not read back as some slot's app port.
  for (const slot of [0, 1, 2, 7]) {
    const { apiPort, resolutionPort, reviewPort } = deriveStackResources(slot);
    assert.equal(slotForAppPort(apiPort), undefined);
    assert.equal(slotForAppPort(reviewPort), undefined);
    assert.equal(slotForAppPort(resolutionPort), undefined);
  }
});

test("a control port maps back to the slot that owns it", function () {
  for (const slot of [0, 1, 2, 7]) {
    const resources = deriveStackResources(slot);
    assert.equal(slotForControlPort(resources.pcAdminPort), slot);
  }
});

test("the old stride-1 control ports no longer name a slot", function () {
  // 8081/8082 were slots 1 and 2 before the stride changed. A stale command
  // carrying one must hit nothing rather than a live neighbour's control API,
  // which is the whole point of the change.
  assert.equal(slotForControlPort(8081), undefined);
  assert.equal(slotForControlPort(8082), undefined);
  assert.equal(slotForControlPort(8079), undefined);
});

test("slot-aware env paths preserve the legacy slot-0 filename", function () {
  assert.equal(localChainEnvFileForSlot(0), localChainEnvFile);
  assert.equal(localChainEnvFileForSlot(1), `${localChainEnvFile}.1`);
  assert.throws(() => localChainEnvFileForSlot(-1), /non-negative integer/);
  assert.equal(localDevIndexerHealthFileForSlot(0), localDevIndexerHealthFile);
  assert.equal(
    localDevIndexerHealthFileForSlot(1),
    `${localDevIndexerHealthFile}.1`,
  );
  assert.throws(
    () => localDevIndexerHealthFileForSlot(-1),
    /non-negative integer/,
  );
});

test("no two slots bind the same port, across every resource", function () {
  // The essential guard on the slot model. A collision here is not an abstract
  // failed assertion: it is slot N's chain dying on
  // `address 0.0.0.0:30303 (listener service) is already in use` while slot 0
  // keeps running, which reads as "my stack is broken" rather than "these two
  // stacks overlap". Adjacent slots are the case that actually happens — a
  // human on 0, an agent worktree on 1 — so the range starts there.
  //
  // The range ends at 44 because that is the truth, not because 45 slots is
  // enough. The stride is 10 and two families sit on the same last digit —
  // authrpc (…1) and metrics (…1) — so they cross exactly 45 slots apart:
  // slot 45's authrpc is slot 0's metrics port. Reaching it needs 45 stacks
  // live at once, each with its own database, app, and API, and `resolveSlot`
  // probes every port in this list before claiming a slot, so the crossing is
  // detected and skipped rather than hit. Widening this loop past 44 without
  // moving a base is therefore expected to fail, and the failure would be
  // real.
  const bound = new Map<number, string>();

  for (let slot = 0; slot <= 44; slot += 1) {
    const resources = deriveStackResources(slot);
    const ports: ReadonlyArray<readonly [string, number]> = [
      ["chainPort", resources.chainPort],
      ["chainAuthRpcPort", resources.chainAuthRpcPort],
      ["chainMetricsPort", resources.chainMetricsPort],
      ["chainP2pPort", resources.chainP2pPort],
      ["apiPort", resources.apiPort],
      ["appPort", resources.appPort],
      ["reviewPort", resources.reviewPort],
      ["resolutionPort", resources.resolutionPort],
      ["pcAdminPort", resources.pcAdminPort],
    ];

    for (const [name, port] of ports) {
      const owner = bound.get(port);
      assert.equal(
        owner,
        undefined,
        `port ${port} is both slot ${slot}'s ${name} and ${owner}`,
      );
      bound.set(port, `slot ${slot}'s ${name}`);
    }
  }
});

test("the chain's four ports come from the arc-node derivation", function () {
  // Not a restatement of the numbers above: this asserts there is one source
  // of truth for the offsets. If `deriveStackResources` grew its own copy of
  // "authrpc sits six above http", the two would agree today and drift the
  // first time reth's defaults move.
  for (const slot of [0, 1, 5]) {
    const resources = deriveStackResources(slot);

    assert.deepEqual(deriveArcNodePorts(resources.chainPort), {
      authrpc: resources.chainAuthRpcPort,
      http: resources.chainPort,
      metrics: resources.chainMetricsPort,
      p2p: resources.chainP2pPort,
    });
  }
});

test("each slot owns a distinct chain datadir inside the repo", function () {
  // The datadir is bound as exclusively as a port — arc-node holds an MDBX
  // lock on it for the life of the process — so two slots sharing one is the
  // same failure as two slots sharing 8545, with a worse error message
  // (ADR 0028 G7).
  const slots = [0, 1, 2, 7];
  const dataDirs = slots.map((slot) => deriveStackResources(slot).chainDataDir);

  assert.equal(new Set(dataDirs).size, dataDirs.length);

  for (const slot of slots) {
    const { chainDataDir } = deriveStackResources(slot);
    assert.ok(
      chainDataDir.startsWith(`${arcChainInstanceDir(slot)}/`),
      `slot ${slot} datadir ${chainDataDir} escapes its instance directory`,
    );
    // Anywhere but `.local-dev/` is outside the repository's ignored tree,
    // which AGENTS.md forbids writing to without approval (ADR 0028 G9).
    assert.ok(chainDataDir.includes("/.local-dev/arc-chain/"));
  }

  assert.throws(() => arcChainInstanceDir(-1), /non-negative integer/);
});
