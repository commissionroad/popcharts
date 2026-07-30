import { NextResponse } from "next/server";

import { devToolsEnabled } from "@/features/dev-settings/dev-settings";
import { configuredPopChartsChainId } from "@/integrations/contracts/config";
import { generateLocalMarket } from "@/integrations/local-market-generator/generate-local-market";
import { presentError } from "@/lib/error-handling";

// Prefixed onto the generator's own progress lines in the app server log, so a
// developer reading that log can tell this route's markets apart from the ones
// `pnpm run local:create-market` writes.
const LOG_LABEL = "app-dev-autofill";

/**
 * The dev-tools flag gates the menu that calls this, so it gates the route too
 * — but the flag is a public build-time env var, and a deployment that shipped
 * it on by accident would expose an unauthenticated endpoint that makes
 * outbound requests on the server's behalf. The menu's read-only toggles can
 * live with that; a fetching endpoint should not, so this also refuses in any
 * production build regardless of the flag.
 */
function generatedMarketRouteEnabled() {
  return devToolsEnabled() && process.env.NODE_ENV !== "production";
}

/**
 * Generates one local-dev market — the same live crypto or weather market the
 * local CLI creates — for the create form's autofill tool. Nothing is created
 * on-chain and nothing is persisted: the response is form content.
 */
export async function GET() {
  if (!generatedMarketRouteEnabled()) {
    return NextResponse.json(
      { error: "Local dev tools are not enabled." },
      { status: 404 }
    );
  }

  try {
    const market = await generateLocalMarket({
      chainId: configuredPopChartsChainId,
      indexerApiBaseUrl: process.env.POPCHARTS_INDEXER_API_URL?.trim() || undefined,
      logLabel: LOG_LABEL,
    });

    return NextResponse.json(market);
  } catch (error) {
    return NextResponse.json(
      {
        error: presentError(error, {
          context: { operation: "generate-local-market" },
          fallback:
            "No live source could be reached to generate a market. The app server log has the failure from each source.",
        }),
      },
      { status: 502 }
    );
  }
}
