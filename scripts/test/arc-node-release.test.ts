import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ARC_NODE_ARCHIVE_SHA256,
  ARC_NODE_VERSION,
  arcNodeArchiveName,
  arcNodeArchiveUrl,
  resolveArcNodeTarget,
} from "../shared/chain/arcNodeRelease.ts";
import { deriveArcNodePorts } from "../shared/chain/arcNodePorts.ts";

/**
 * Guards on the Arc node pin and the per-instance port derivation.
 *
 * The port assertions are the load-bearing ones. A single arc-node instance
 * binds five resources, and three of them are easy to forget because reth
 * only reports them one failure at a time: striding just the HTTP port gets
 * a second instance as far as a P2P collision on 30303, and once that is
 * fixed, an AUTH collision on 8551. See ADR 0028 G7.
 */

describe("arc node release pin", () => {
  it("publishes a checksum for every supported target", () => {
    for (const platform of [
      { arch: "x64", platform: "linux" as const },
      { arch: "arm64", platform: "linux" as const },
      { arch: "arm64", platform: "darwin" as const },
    ]) {
      const resolved = resolveArcNodeTarget(platform.platform, platform.arch);
      assert.equal(resolved.ok, true, `${platform.platform}/${platform.arch}`);

      if (resolved.ok) {
        const digest = ARC_NODE_ARCHIVE_SHA256[resolved.target];
        assert.match(
          digest ?? "",
          /^[0-9a-f]{64}$/,
          `missing or malformed checksum for ${resolved.target}`,
        );
      }
    }
  });

  it("reports Intel macOS as unsupported rather than guessing a target", () => {
    const resolved = resolveArcNodeTarget("darwin", "x64");

    assert.equal(resolved.ok, false);
    if (!resolved.ok) {
      assert.match(resolved.reason, /Intel macOS/);
    }
  });

  it("builds the archive name and URL from the pinned version", () => {
    const target = "x86_64-unknown-linux-gnu";

    assert.equal(
      arcNodeArchiveName(target),
      `arc-node-${ARC_NODE_VERSION}-${target}.tar.gz`,
    );
    assert.ok(
      arcNodeArchiveUrl(target).endsWith(
        `/${ARC_NODE_VERSION}/${arcNodeArchiveName(target)}`,
      ),
    );
  });
});

describe("arc node port derivation", () => {
  it("returns reth's defaults at the default HTTP port", () => {
    assert.deepEqual(deriveArcNodePorts(8545), {
      authrpc: 8551,
      http: 8545,
      metrics: 9001,
      p2p: 30303,
    });
  });

  it("moves every port together, not just the HTTP one", () => {
    const first = deriveArcNodePorts(8545);
    const second = deriveArcNodePorts(8555);

    for (const key of ["authrpc", "http", "metrics", "p2p"] as const) {
      assert.notEqual(
        first[key],
        second[key],
        `${key} collides between instances 10 ports apart`,
      );
    }
  });

  it("keeps two stack slots free of any shared port", () => {
    // The slot stride is 10 (scripts/shared/localStack/ports.ts). Two
    // adjacent slots must not share a single bound port, or slot N dies on
    // whichever one reth happens to bind first.
    const slots = [0, 1, 2].map((slot) => deriveArcNodePorts(8545 + 10 * slot));
    const bound = slots.flatMap((ports) => Object.values(ports));

    assert.equal(
      new Set(bound).size,
      bound.length,
      "two slots bind the same port",
    );
  });
});
