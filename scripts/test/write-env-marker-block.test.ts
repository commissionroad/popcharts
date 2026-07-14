import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { writeEnvMarkerBlock } from "../shared/env/writeEnvMarkerBlock.ts";

function tempEnvFile(): string {
  return join(mkdtempSync(join(tmpdir(), "popcharts-env-block-")), ".env.development.local");
}

// The block protocol/scripts/deploy-devchain.ts leaves behind. Its keys
// overlap the local-dev block, and dotenv resolves duplicates last-one-wins,
// so a stale copy must not survive a local-dev env write.
const DEVCHAIN_BLOCK = [
  "# BEGIN POPCHARTS DEVCHAIN",
  "NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS=0xstale",
  "NEXT_PUBLIC_POPCHARTS_PREGRAD_MANAGER_ADDRESS=0xstale",
  "# END POPCHARTS DEVCHAIN",
  "",
].join("\n");

describe("writeEnvMarkerBlock", function () {
  it("creates the file with a marked block when missing", function () {
    const filePath = tempEnvFile();

    writeEnvMarkerBlock({ env: { FOO: "1", BAR: "2" }, filePath });

    assert.equal(
      readFileSync(filePath, "utf8"),
      "# BEGIN POPCHARTS LOCAL DEV\nFOO=1\nBAR=2\n# END POPCHARTS LOCAL DEV\n",
    );
  });

  it("replaces an existing block in place, keeping surrounding content", function () {
    const filePath = tempEnvFile();
    writeFileSync(
      filePath,
      "HAND_WRITTEN=keep\n\n# BEGIN POPCHARTS LOCAL DEV\nFOO=old\n# END POPCHARTS LOCAL DEV\n\nTRAILING=keep\n",
    );

    writeEnvMarkerBlock({ env: { FOO: "new" }, filePath });

    assert.equal(
      readFileSync(filePath, "utf8"),
      "HAND_WRITTEN=keep\n\n# BEGIN POPCHARTS LOCAL DEV\nFOO=new\n# END POPCHARTS LOCAL DEV\n\nTRAILING=keep\n",
    );
  });

  it("removes a stale devchain sibling block so its duplicate keys cannot shadow ours", function () {
    const filePath = tempEnvFile();
    writeFileSync(
      filePath,
      [
        "# BEGIN POPCHARTS LOCAL DEV",
        "NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS=0xold",
        "# END POPCHARTS LOCAL DEV",
        "",
        DEVCHAIN_BLOCK,
      ].join("\n"),
    );

    writeEnvMarkerBlock(
      { env: { NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS: "0xfresh" }, filePath },
    );

    const content = readFileSync(filePath, "utf8");
    assert.doesNotMatch(content, /POPCHARTS DEVCHAIN/);
    assert.deepEqual(content.match(/^NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS=.*$/gm), [
      "NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS=0xfresh",
    ]);
  });

  it("takes over a file that only has a devchain block", function () {
    const filePath = tempEnvFile();
    writeFileSync(filePath, `HAND_WRITTEN=keep\n\n${DEVCHAIN_BLOCK}`);

    writeEnvMarkerBlock({ env: { FOO: "1" }, filePath });

    assert.equal(
      readFileSync(filePath, "utf8"),
      "HAND_WRITTEN=keep\n\n# BEGIN POPCHARTS LOCAL DEV\nFOO=1\n# END POPCHARTS LOCAL DEV\n",
    );
  });
});
