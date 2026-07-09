import { NextResponse } from "next/server";

import {
  createMarketsApiClient,
  MarketsApiError,
} from "@/integrations/indexer/markets-api";
import { presentError } from "@/lib/error-handling";

/**
 * Same-origin proxy for the indexer's portfolio endpoint, so the portfolio
 * page can poll from the browser using the server-side indexer URL (the
 * browser cannot read POPCHARTS_INDEXER_API_URL directly, and local dev only
 * exposes the server-side variable — see the order book proxy).
 */
export async function GET(request: Request) {
  const apiBaseUrl = readIndexerApiBaseUrl();

  if (!apiBaseUrl) {
    return NextResponse.json(
      { error: "POPCHARTS_INDEXER_API_URL is required to read portfolios." },
      { status: 500 }
    );
  }

  const requestUrl = new URL(request.url);
  const chainId = requestUrl.searchParams.get("chainId");
  const owner = requestUrl.searchParams.get("owner");

  if (!chainId || !owner) {
    return NextResponse.json(
      { error: "chainId and owner query parameters are required." },
      { status: 400 }
    );
  }

  try {
    const client = createMarketsApiClient({ baseUrl: apiBaseUrl });
    const portfolio = await client.getPortfolio({ chainId, owner });

    if (!portfolio) {
      return NextResponse.json({ error: "Portfolio not found." }, { status: 404 });
    }

    return NextResponse.json(portfolio);
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: error instanceof MarketsApiError ? 502 : 500 }
    );
  }
}

function getErrorMessage(error: unknown) {
  // Log the raw failure server-side; return only well-formed copy to the client.
  return presentError(error, {
    context: { operation: "api/indexer/portfolio" },
    fallback: "Portfolio request failed.",
  });
}

function readIndexerApiBaseUrl() {
  return (
    process.env.POPCHARTS_INDEXER_API_URL ??
    process.env.NEXT_PUBLIC_POPCHARTS_INDEXER_API_URL
  );
}
