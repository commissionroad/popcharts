import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { updateDevchainEnvBlock } from "../../scripts/shared/env/updateDevchainEnvBlock.js";

// The block scripts/local-dev.ts maintains. Its keys overlap the devchain
// block, and dotenv resolves duplicates last-one-wins, so a stale copy must
// not survive a devchain env write.
const LOCAL_DEV_BLOCK = [
  "# BEGIN POPCHARTS LOCAL DEV",
  "NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS=0xstale",
  "NEXT_PUBLIC_POPCHARTS_PREGRAD_MANAGER_ADDRESS=0xstale",
  "# END POPCHARTS LOCAL DEV",
  "",
].join("\n");

describe("updateDevchainEnvBlock", function () {
  it("appends a marked block to empty content", function () {
    assert.equal(
      updateDevchainEnvBlock({ entries: ["FOO=1", "BAR=2"], existing: "" }),
      "# BEGIN POPCHARTS DEVCHAIN\nFOO=1\nBAR=2\n# END POPCHARTS DEVCHAIN\n",
    );
  });

  it("replaces an existing block in place, keeping surrounding content", function () {
    const existing =
      "HAND_WRITTEN=keep\n\n# BEGIN POPCHARTS DEVCHAIN\nFOO=old\n# END POPCHARTS DEVCHAIN\n\nTRAILING=keep\n";

    assert.equal(
      updateDevchainEnvBlock({ entries: ["FOO=new"], existing }),
      "HAND_WRITTEN=keep\n\n# BEGIN POPCHARTS DEVCHAIN\nFOO=new\n# END POPCHARTS DEVCHAIN\n\nTRAILING=keep\n",
    );
  });

  it("removes a stale local-dev sibling block so its duplicate keys cannot shadow ours", function () {
    const existing = [
      LOCAL_DEV_BLOCK,
      "",
      "# BEGIN POPCHARTS DEVCHAIN",
      "NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS=0xold",
      "# END POPCHARTS DEVCHAIN",
      "",
    ].join("\n");

    const next = updateDevchainEnvBlock({
      entries: ["NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS=0xfresh"],
      existing,
    });

    assert.doesNotMatch(next, /POPCHARTS LOCAL DEV/);
    assert.deepEqual(next.match(/^NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS=.*$/gm), [
      "NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS=0xfresh",
    ]);
  });

  it("takes over content that only has a local-dev block", function () {
    assert.equal(
      updateDevchainEnvBlock({
        entries: ["FOO=1"],
        existing: `HAND_WRITTEN=keep\n\n${LOCAL_DEV_BLOCK}`,
      }),
      "HAND_WRITTEN=keep\n\n# BEGIN POPCHARTS DEVCHAIN\nFOO=1\n# END POPCHARTS DEVCHAIN\n",
    );
  });
});
