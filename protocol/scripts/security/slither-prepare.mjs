// Prepare a Slither-readable build tree from Hardhat 3 artifacts.
//
// Why this exists: Slither's `crytic-compile` (through 0.3.x) reads Hardhat's
// build-info in the Hardhat 2 shape — a single `{solcVersion, input, output}`
// JSON per compilation. Hardhat 3 splits that into two files, `solc-*.json`
// (input) and `solc-*.output.json` (output), and names sources with a
// virtualized scheme (`project/…`, `npm/pkg@ver/…`). crytic-compile chokes on
// both. This script reassembles each pair into the HH2 shape and materializes
// the exact source tree solc saw (each source's inline `content`) under
// `.slither/`, keyed by the original virtualized names, so crytic-compile
// resolves every unit and Slither analyzes them. No source is renamed, so the
// ASTs' internal import references stay consistent.
//
// Run `hardhat build` (clean) first so all build-info is from one consistent
// compilation — stale build-info produces source-map/content mismatches.
//
// Output: `<protocol>/.slither/` (git-ignored). Consumed by slither-run.py.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const src = path.join(root, "artifacts/build-info");
const work = path.join(root, ".slither");

if (!fs.existsSync(src)) {
  console.error(`No ${src}. Run \`hardhat build\` first.`);
  process.exit(1);
}

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(path.join(work, "artifacts/build-info"), { recursive: true });

let units = 0;
let sources = 0;
const inputs = fs
  .readdirSync(src)
  .filter((f) => f.endsWith(".json") && !f.endsWith(".output.json"));

for (const f of inputs) {
  const inp = JSON.parse(fs.readFileSync(path.join(src, f)));
  const outFile = f.replace(/\.json$/, ".output.json");
  if (!fs.existsSync(path.join(src, outFile))) continue;
  const outp = JSON.parse(fs.readFileSync(path.join(src, outFile)));

  for (const [name, source] of Object.entries(inp.input.sources)) {
    if (typeof source.content !== "string") continue;
    const dest = path.join(work, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest)) {
      fs.writeFileSync(dest, source.content);
      sources += 1;
    }
  }

  const merged = {
    _format: "hh-sol-build-info-1",
    id: inp.id,
    solcVersion: inp.solcVersion,
    solcLongVersion: inp.solcLongVersion,
    input: inp.input,
    output: outp.output,
  };
  fs.writeFileSync(path.join(work, "artifacts/build-info", f), JSON.stringify(merged));
  units += 1;
}

console.log(
  `slither-prepare: ${units} build-info unit(s), ${sources} source(s) → ${path.relative(root, work)}`,
);
