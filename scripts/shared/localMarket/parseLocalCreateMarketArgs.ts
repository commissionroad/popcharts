import { resolveRepoPath } from "../paths.ts";
import {
  isGeneratedMarketKind,
  type GeneratedMarketKind,
} from "./generatedMarketOptions.ts";

/** Parsed command-line options for the local market creation helper. */
export type LocalCreateMarketOptions = {
  apiBaseUrl: string | undefined;
  envFile: string | undefined;
  help: boolean;
  kind: GeneratedMarketKind | "random";
  preview: boolean;
  stack: string | undefined;
};

/**
 * Parses local-create-market command-line arguments, throwing on any token it
 * does not recognize rather than ignoring it. `--flag value` and `--flag=value`
 * are equivalent and the last occurrence wins. Two results are load-bearing for
 * stack targeting: `--stack` falls back to `POPCHARTS_STACK`, and
 * `--local-chain-env` paths resolve against the repo root, not the cwd.
 */
export function parseLocalCreateMarketArgs(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): LocalCreateMarketOptions {
  const options: LocalCreateMarketOptions = {
    apiBaseUrl: undefined,
    envFile: undefined,
    help: false,
    kind: "random",
    preview: false,
    stack: env.POPCHARTS_STACK,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--preview") {
      options.preview = true;
    } else if (arg === "--local-chain-env") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--local-chain-env requires a path.");
      }
      options.envFile = resolveRepoPath(value);
      index += 1;
    } else if (arg.startsWith("--local-chain-env=")) {
      options.envFile = resolveRepoPath(arg.slice("--local-chain-env=".length));
    } else if (arg === "--api-url") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--api-url requires a URL.");
      }
      options.apiBaseUrl = value;
      index += 1;
    } else if (arg.startsWith("--api-url=")) {
      options.apiBaseUrl = arg.slice("--api-url=".length);
    } else if (arg === "--stack") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--stack requires a slot or instance id.");
      }
      options.stack = value;
      index += 1;
    } else if (arg.startsWith("--stack=")) {
      options.stack = arg.slice("--stack=".length);
    } else if (arg === "--kind") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--kind requires crypto, weather, or random.");
      }
      options.kind = parseKind(value);
      index += 1;
    } else if (arg.startsWith("--kind=")) {
      options.kind = parseKind(arg.slice("--kind=".length));
    } else {
      throw new Error(`Unknown option ${arg}. Use --help.`);
    }
  }

  return options;
}

/** The `--help` text, documenting the same flags the parser above accepts. */
export function printLocalCreateMarketUsage(): void {
  console.log(`Usage: pnpm run local:create-market -- [options]

Create one local market against the currently running local development chain.
By default, the helper randomly generates a near-term crypto or weather market
from live public sources, creates it onchain, then saves matching metadata to
the local API.

Options:
  --api-url <url>          Save generated metadata to this API base URL. Only
                            redirects the metadata; the market is still created
                            on the resolved stack's chain. Defaults to that
                            stack's API port, then POPCHARTS_INDEXER_API_URL,
                            then http://127.0.0.1:$LOCAL_API_PORT.
  --kind <kind>            Generate crypto, weather, or random.
                            Defaults to random.
  --local-chain-env <path>  Load a generated local-chain env file. Names the
                            chain outright, so it bypasses stack registry
                            resolution.
  --stack <slot|id>         Choose a running stack by slot or instance id.
                            Defaults to POPCHARTS_STACK; with multiple stacks,
                            interactive terminals prompt when neither is set.
  --preview                 Print generated metadata JSON without creating a market.
  -h, --help                Show this help.

Start the local stack first with 'just local-dev-control' or 'just local-dev'.`);
}

function parseKind(value: string): GeneratedMarketKind | "random" {
  if (value === "random" || isGeneratedMarketKind(value)) {
    return value;
  }

  throw new Error("--kind must be crypto, weather, or random.");
}
