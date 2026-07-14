import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Imported across the workspace boundary exactly as deploy-devchain.ts does,
// so this suite also proves the hardhat loader resolves the shared module.
import { updateAppEnvMarkerBlock } from "../../../scripts/shared/env/appEnvMarkerBlock.js";

describe("updateAppEnvMarkerBlock", function () {
  it("appends a marked block to empty content", function () {
    assert.equal(
      updateAppEnvMarkerBlock({ entries: ["FOO=1", "BAR=2"], existing: "" }),
      "# BEGIN POPCHARTS APP ENV\nFOO=1\nBAR=2\n# END POPCHARTS APP ENV\n",
    );
  });

  it("replaces an existing block in place, keeping surrounding content", function () {
    const existing =
      "HAND_WRITTEN=keep\n\n# BEGIN POPCHARTS APP ENV\nFOO=old\n# END POPCHARTS APP ENV\n\nTRAILING=keep\n";

    assert.equal(
      updateAppEnvMarkerBlock({ entries: ["FOO=new"], existing }),
      "HAND_WRITTEN=keep\n\n# BEGIN POPCHARTS APP ENV\nFOO=new\n# END POPCHARTS APP ENV\n\nTRAILING=keep\n",
    );
  });

  it("migrates legacy per-tool blocks so their duplicate keys cannot shadow ours", function () {
    const existing = [
      "# BEGIN POPCHARTS LOCAL DEV",
      "NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS=0xstale",
      "# END POPCHARTS LOCAL DEV",
      "",
      "# BEGIN POPCHARTS DEVCHAIN",
      "NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS=0xstaler",
      "# END POPCHARTS DEVCHAIN",
      "",
    ].join("\n");

    const next = updateAppEnvMarkerBlock({
      entries: ["NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS=0xfresh"],
      existing,
    });

    assert.doesNotMatch(next, /POPCHARTS LOCAL DEV|POPCHARTS DEVCHAIN/);
    assert.deepEqual(next.match(/^NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS=.*$/gm), [
      "NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS=0xfresh",
    ]);
  });
});
