import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { writeEnvMarkerBlock } from "../shared/env/writeEnvMarkerBlock.ts";

function tempEnvFile(): string {
  return join(mkdtempSync(join(tmpdir(), "popcharts-env-block-")), ".env.development.local");
}

// The per-tool blocks written before the marker was unified. Their keys
// overlap, and dotenv resolves duplicates last-one-wins, so stale copies must
// not survive a write (this shadowing shipped a wrong collateral address to
// the app on 2026-07-14).
const LEGACY_LOCAL_DEV_BLOCK = [
  "# BEGIN POPCHARTS LOCAL DEV",
  "NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS=0xstale",
  "# END POPCHARTS LOCAL DEV",
  "",
].join("\n");
const LEGACY_DEVCHAIN_BLOCK = [
  "# BEGIN POPCHARTS DEVCHAIN",
  "NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS=0xstaler",
  "# END POPCHARTS DEVCHAIN",
  "",
].join("\n");

describe("writeEnvMarkerBlock", function () {
  it("creates the file with a marked block when missing", function () {
    const filePath = tempEnvFile();

    writeEnvMarkerBlock({ env: { FOO: "1", BAR: "2" }, filePath });

    assert.equal(
      readFileSync(filePath, "utf8"),
      "# BEGIN POPCHARTS APP ENV\nFOO=1\nBAR=2\n# END POPCHARTS APP ENV\n",
    );
  });

  it("replaces an existing block in place, keeping surrounding content", function () {
    const filePath = tempEnvFile();
    writeFileSync(
      filePath,
      "HAND_WRITTEN=keep\n\n# BEGIN POPCHARTS APP ENV\nFOO=old\n# END POPCHARTS APP ENV\n\nTRAILING=keep\n",
    );

    writeEnvMarkerBlock({ env: { FOO: "new" }, filePath });

    assert.equal(
      readFileSync(filePath, "utf8"),
      "HAND_WRITTEN=keep\n\n# BEGIN POPCHARTS APP ENV\nFOO=new\n# END POPCHARTS APP ENV\n\nTRAILING=keep\n",
    );
  });

  it("migrates legacy per-tool blocks so their duplicate keys cannot shadow ours", function () {
    const filePath = tempEnvFile();
    writeFileSync(filePath, `${LEGACY_LOCAL_DEV_BLOCK}\n${LEGACY_DEVCHAIN_BLOCK}`);

    writeEnvMarkerBlock(
      { env: { NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS: "0xfresh" }, filePath },
    );

    const content = readFileSync(filePath, "utf8");
    assert.doesNotMatch(content, /POPCHARTS LOCAL DEV|POPCHARTS DEVCHAIN/);
    assert.deepEqual(content.match(/^NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS=.*$/gm), [
      "NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS=0xfresh",
    ]);
  });

  it("keeps hand-written content while migrating a legacy block", function () {
    const filePath = tempEnvFile();
    writeFileSync(filePath, `HAND_WRITTEN=keep\n\n${LEGACY_DEVCHAIN_BLOCK}`);

    writeEnvMarkerBlock({ env: { FOO: "1" }, filePath });

    assert.equal(
      readFileSync(filePath, "utf8"),
      "HAND_WRITTEN=keep\n\n# BEGIN POPCHARTS APP ENV\nFOO=1\n# END POPCHARTS APP ENV\n",
    );
  });
});
