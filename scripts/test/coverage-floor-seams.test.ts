import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const SCRIPT = join(import.meta.dirname, "..", "ci-check-coverage-floor.ts");

// protocol-solidity workspace filter: contracts/ minus contracts/mocks/.
const LCOV = [
  "SF:contracts/PregradManager.sol",
  "LF:100",
  "LH:95",
  "end_of_record",
  "SF:contracts/mocks/MockCollateral.sol",
  "LF:50",
  "LH:0",
  "end_of_record",
].join("\n");

function runFloor(minLines: string) {
  const dir = mkdtempSync(join(tmpdir(), "floor-"));
  const lcovPath = join(dir, "lcov.info");
  writeFileSync(lcovPath, LCOV);
  return spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      SCRIPT,
      "--workspace",
      "protocol-solidity",
      "--lcov",
      lcovPath,
      "--min-lines",
      minLines,
    ],
    { encoding: "utf8" },
  );
}

describe("ci-check-coverage-floor", () => {
  it("passes at or below the measured percentage and excludes mocks", () => {
    const result = runFloor("95.0");
    assert.equal(result.status, 0, result.stderr);
    // 95/100, not 95/150 — the mocks record must be filtered out.
    assert.match(result.stdout, /95\.00% \(95\/100\) meets the 95% floor/);
  });

  it("fails above the measured percentage with the ADR pointer", () => {
    const result = runFloor("95.1");
    assert.equal(result.status, 1);
    assert.match(result.stdout, /is BELOW the 95.1% floor/);
    assert.match(result.stderr, /Coverage floor violated \(ADR 0017\)/);
  });

  it("rejects bad arguments", () => {
    const result = runFloor("not-a-number");
    assert.equal(result.status, 2);
  });

  it("compares raw counts, not the two-decimal display rounding", () => {
    // 816/2248 = 36.2989…%, which displays as 36.30% — a rounded
    // comparison would wrongly pass a 36.3 floor.
    const dir = mkdtempSync(join(tmpdir(), "floor-"));
    const lcovPath = join(dir, "lcov.info");
    writeFileSync(
      lcovPath,
      ["SF:contracts/PregradManager.sol", "LF:2248", "LH:816", "end_of_record"].join(
        "\n",
      ),
    );
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        SCRIPT,
        "--workspace",
        "protocol-solidity",
        "--lcov",
        lcovPath,
        "--min-lines",
        "36.3",
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /36\.30% \(816\/2248\) is BELOW the 36.3% floor/);
  });
});
