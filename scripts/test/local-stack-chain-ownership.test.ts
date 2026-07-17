import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyChainPortOwnership } from "../shared/localStack/classifyChainPortOwnership.ts";
import type { StackDescriptor } from "../shared/localStack/registry.ts";

const descriptor: StackDescriptor = {
  instanceId: "popcharts-slot0",
  slot: 0,
  kind: "human",
  worktreePath: "/src/popcharts",
  chainPort: 8545,
  chainId: 31337,
  apiPort: 3001,
  appPort: 3000,
  reviewPort: 3002,
  resolutionPort: 3004,
  pcAdminPort: 8080,
  dbName: "popcharts",
  envFilePath: "/src/popcharts/server/.env.local-chain",
  deployAddressesPath: null,
  controlPid: 123,
  startedAt: "2026-07-17T12:00:00.000Z",
};

test("chain port ownership permits only this instance's live descriptor", function () {
  assert.equal(
    classifyChainPortOwnership({
      chainPort: 8545,
      instanceId: descriptor.instanceId,
      isRpcResponding: true,
      liveDescriptors: [descriptor],
    }),
    "this-instance",
  );
  assert.equal(
    classifyChainPortOwnership({
      chainPort: 8545,
      instanceId: "another-slot0",
      isRpcResponding: true,
      liveDescriptors: [descriptor],
    }),
    "foreign-or-unknown",
  );
  assert.equal(
    classifyChainPortOwnership({
      chainPort: 8545,
      instanceId: descriptor.instanceId,
      isRpcResponding: true,
      liveDescriptors: [],
    }),
    "foreign-or-unknown",
  );
  assert.equal(
    classifyChainPortOwnership({
      chainPort: 8545,
      instanceId: descriptor.instanceId,
      isRpcResponding: false,
      liveDescriptors: [descriptor],
    }),
    "free",
  );
});
