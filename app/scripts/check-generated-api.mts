// Verifies the committed orval client in src/integrations/indexer/generated
// is exactly what regenerating from server/generated/openapi.json produces,
// mirroring abi:check. Regenerates into a throwaway directory inside app/ (so
// prettier config resolution matches) and compares trees without touching the
// committed files.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const committedRoot = resolve(appRoot, "src/integrations/indexer/generated");
// Deliberately not dot-prefixed, not gitignored, and not prettierignored:
// prettier (run by orval) silently skips ignored paths, and the regenerated
// tree must be formatted exactly like the committed one. The directory is
// removed on entry and in the finally block, so it never lingers.
const tmpRoot = resolve(appRoot, "api-check-tmp");
const specPath =
  process.env.POPCHARTS_API_SPEC ??
  resolve(appRoot, "../server/generated/openapi.json");

async function main(): Promise<void> {
  if (!existsSync(specPath)) {
    throw new Error(`OpenAPI spec not found at ${specPath}`);
  }

  await rm(tmpRoot, { recursive: true, force: true });
  await mkdir(tmpRoot, { recursive: true });

  try {
    const configPath = join(tmpRoot, "orval.config.mjs");
    const generatedRoot = join(tmpRoot, "generated");
    await writeFile(
      configPath,
      `export default {
  popchartsApi: {
    input: { target: ${JSON.stringify(specPath)} },
    output: {
      client: "fetch",
      mode: "tags-split",
      prettier: true,
      schemas: ${JSON.stringify(join(generatedRoot, "models"))},
      target: ${JSON.stringify(generatedRoot)},
    },
  },
};
`
    );

    execFileSync("pnpm", ["exec", "orval", "--config", relative(appRoot, configPath)], {
      cwd: appRoot,
      stdio: ["ignore", "ignore", "inherit"],
    });

    const committed = await listFiles(committedRoot);
    const regenerated = await listFiles(generatedRoot);
    const problems: string[] = [];

    for (const file of regenerated) {
      if (!committed.includes(file)) {
        problems.push(`missing from committed client: ${file}`);
      }
    }

    for (const file of committed) {
      if (!regenerated.includes(file)) {
        problems.push(`stale committed file (not regenerated): ${file}`);
        continue;
      }

      const [current, fresh] = await Promise.all([
        readFile(join(committedRoot, file), "utf8"),
        readFile(join(generatedRoot, file), "utf8"),
      ]);

      if (current !== fresh) {
        problems.push(`content differs: ${file}`);
      }
    }

    if (problems.length > 0) {
      console.error(
        `Committed API client at ${relative(appRoot, committedRoot)} is out of date ` +
          "with server/generated/openapi.json. Run `pnpm run api:generate`."
      );
      for (const problem of problems) {
        console.error(`  - ${problem}`);
      }
      process.exitCode = 1;
    }
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .sort();
}

await main();
