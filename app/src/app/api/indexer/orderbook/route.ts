import { NextResponse } from "next/server";

import {
  createMarketsApiClient,
  MarketsApiError,
} from "@/integrations/indexer/markets-api";

/**
 * Same-origin proxy for the indexer's venue order book endpoint, so the
 * order book widget can poll from the browser using the server-side indexer
 * URL (the browser cannot read POPCHARTS_INDEXER_API_URL directly).
 */
export async function GET(request: Request) {
  const apiBaseUrl = readIndexerApiBaseUrl();

  if (!apiBaseUrl) {
    return NextResponse.json(
      { error: "POPCHARTS_INDEXER_API_URL is required to read order books." },
      { status: 500 }
    );
  }

  const requestUrl = new URL(request.url);
  const chainId = requestUrl.searchParams.get("chainId");
  const marketId = requestUrl.searchParams.get("marketId");

  if (!chainId || !marketId) {
    return NextResponse.json(
      { error: "chainId and marketId query parameters are required." },
      { status: 400 }
    );
  }

  try {
    const client = createMarketsApiClient({ baseUrl: apiBaseUrl });
    const book = await client.getMarketOrderBook({ chainId, marketId });

    if (!book) {
      return NextResponse.json({ error: "Order book not found." }, { status: 404 });
    }

    return NextResponse.json(book);
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: error instanceof MarketsApiError ? 502 : 500 }
    );
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Order book request failed.";
}

function readIndexerApiBaseUrl() {
  return (
    process.env.POPCHARTS_INDEXER_API_URL ??
    process.env.NEXT_PUBLIC_POPCHARTS_INDEXER_API_URL
  );
}
