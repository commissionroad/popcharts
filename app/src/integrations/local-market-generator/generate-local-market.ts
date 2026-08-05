// Cross-workspace import by relative path, confined to this shim by the
// eslint boundary rule: the root scripts/ tree runs under
// `node --experimental-strip-types`, which cannot load TypeScript from
// node_modules, so the market generator the local CLI uses cannot be published
// as a package the app imports by specifier. Reaching into it directly is what
// keeps this dev tool and `pnpm run local:create-market` generating markets
// from one implementation instead of two.
import { buildGeneratedMarket } from "../../../../scripts/shared/localMarket/generatedMarketPlan.ts";
import { readExistingGeneratedMarketOptions } from "../../../../scripts/shared/localMarket/indexedMarketOptions.ts";
import { addSeconds } from "../../../../scripts/shared/time/utcTime.ts";
import type { GeneratedLocalMarket } from "./types";

/**
 * Generates one local-dev market from live public sources — the same crypto or
 * weather market `pnpm run local:create-market` would create — and returns it
 * with absolute deadlines a form can be filled from.
 *
 * The deadlines are derived from the metadata's own `createdAt` rather than
 * from the moment this returns, because the generated question quotes its
 * resolution time in its text: any drift between the two would publish a
 * market whose deadline contradicts its own question.
 *
 * `indexerApiBaseUrl` is optional and only improves the result: when set, the
 * generator prefers options no existing market has used yet, exactly as the
 * CLI does. Reaching the indexer is never required — its own helper reports an
 * unreachable API and falls back to allowing duplicates.
 */
export async function generateLocalMarket({
  chainId,
  indexerApiBaseUrl,
  logLabel,
}: {
  readonly chainId: number;
  readonly indexerApiBaseUrl: string | undefined;
  readonly logLabel: string;
}): Promise<GeneratedLocalMarket> {
  const usedOptionKeys = indexerApiBaseUrl
    ? await readExistingGeneratedMarketOptions({
        apiBaseUrl: indexerApiBaseUrl,
        chainId,
        logLabel,
      })
    : new Set<string>();
  const generated = await buildGeneratedMarket({
    kind: "random",
    logLabel,
    // The reject path is exercised by the CLI and the lifecycle suite. A form
    // autofill that silently produced an incoherent market a quarter of the
    // time would look like a bug in the generator to whoever clicked it.
    rejectable: "never",
    usedOptionKeys,
  });
  const createdAt = new Date(generated.metadata.createdAt);

  return {
    graduationAt: addSeconds(createdAt, generated.graduationSeconds).toISOString(),
    metadata: generated.metadata,
    resolutionAt: addSeconds(createdAt, generated.resolutionSeconds).toISOString(),
  };
}
