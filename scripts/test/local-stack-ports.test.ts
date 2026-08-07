import assert from "node:assert/strict";
import { test } from "node:test";

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
