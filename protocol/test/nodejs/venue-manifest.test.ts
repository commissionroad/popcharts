import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseRequiredVenueKeys } from "../../scripts/check-venue-deployment.js";
import {
  collectVenueAddressEntries,
  formatVenueContractEntry,
  normalizeVenueContractEntries,
  parseVenueContractSpec,
} from "../../scripts/shared/deployment/venueManifest.js";
import { parseVenueContractOptionList } from "../../scripts/write-venue-manifest.js";

describe("venue manifest helpers", function () {
  it("normalizes CLI contract specs into sorted manifest entries", function () {
    const contracts = normalizeVenueContractEntries([
      {
        required: false,
        spec: "positionManager=0x0000000000000000000000000000000000000002",
      },
      {
        required: true,
        spec: "poolManager=0x0000000000000000000000000000000000000001@0",
      },
    ]);

    assert.deepEqual(
      contracts.map((contract) => contract.name),
      ["poolManager", "positionManager"],
    );
    assert.deepEqual(formatVenueContractEntry(contracts[0]), {
      address: "0x0000000000000000000000000000000000000001",
      blockNumber: "0",
      required: true,
    });
    assert.deepEqual(formatVenueContractEntry(contracts[1]), {
      address: "0x0000000000000000000000000000000000000002",
      required: false,
    });
  });

  it("rejects invalid specs before writing a manifest", function () {
    assert.throws(
      () => parseVenueContractSpec({ required: true, spec: "poolManager" }),
      /name=address/,
    );
    assert.throws(
      () => parseVenueContractSpec({ required: true, spec: "poolManager=0x1234" }),
      /Ethereum address/,
    );
    assert.throws(
      () =>
        parseVenueContractSpec({
          required: true,
          spec: "poolManager=0x0000000000000000000000000000000000000001@-1",
        }),
      /non-negative integer/,
    );
    assert.throws(
      () =>
        normalizeVenueContractEntries([
          {
            required: true,
            spec: "poolManager=0x0000000000000000000000000000000000000001",
          },
          {
            required: false,
            spec: "poolManager=0x0000000000000000000000000000000000000002",
          },
        ]),
      /Duplicate contract entry: poolManager/,
    );
  });

  it("collects checker-readable address entries from venue manifests", function () {
    const entries = collectVenueAddressEntries(
      {
        chainId: 31337,
        deployer: "0x0000000000000000000000000000000000000009",
        contracts: {
          optional: {
            address: "0x0000000000000000000000000000000000000002",
            required: false,
          },
          poolManager: {
            address: "0x0000000000000000000000000000000000000001",
            required: true,
          },
        },
        probes: {
          deterministicFactory: "0x0000000000000000000000000000000000000003",
        },
      },
      new Set(["poolManager", "missing"]),
    );

    assert.deepEqual(entries, [
      {
        address: "0x0000000000000000000000000000000000000003",
        name: "deterministicFactory",
        required: false,
      },
      {
        address: "0x0000000000000000000000000000000000000000",
        name: "missing",
        required: true,
      },
      {
        address: "0x0000000000000000000000000000000000000002",
        name: "optional",
        required: false,
      },
      {
        address: "0x0000000000000000000000000000000000000001",
        name: "poolManager",
        required: true,
      },
    ]);
  });

  it("parses Hardhat task option lists", function () {
    assert.deepEqual(
      parseVenueContractOptionList(
        "poolManager=0x0000000000000000000000000000000000000001@0, positionManager=0x0000000000000000000000000000000000000002",
        true,
      ),
      [
        {
          required: true,
          spec: "poolManager=0x0000000000000000000000000000000000000001@0",
        },
        {
          required: true,
          spec: "positionManager=0x0000000000000000000000000000000000000002",
        },
      ],
    );

    assert.deepEqual(
      [...(parseRequiredVenueKeys("poolManager, deterministicFactory, ") ?? [])],
      ["poolManager", "deterministicFactory"],
    );
    assert.equal(parseRequiredVenueKeys(" , "), undefined);
  });
});
