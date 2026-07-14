import { NextResponse } from "next/server";

import {
  createMarketsApiClient,
  MarketsApiError,
} from "@/integrations/indexer/markets-api";
import { presentError } from "@/lib/error-handling";

/**
 * Same-origin proxy for the indexer's venue orders endpoint, so the open
 * orders panel can poll a wallet's resting maker orders from the browser
 * using the server-side indexer URL (the browser cannot read
 * POPCHARTS_INDEXER_API_URL directly — see the order book proxy).
 */
export async function GET(request: Request) {
  const apiBaseUrl = readIndexerApiBaseUrl();

  if (!apiBaseUrl) {
    return NextResponse.json(
      { error: "POPCHARTS_INDEXER_API_URL is required to read venue orders." },
      { status: 500 }
    );
  }

  const requestUrl = new URL(request.url);
  const chainId = requestUrl.searchParams.get("chainId");
  const marketId = requestUrl.searchParams.get("marketId");
  const owner = requestUrl.searchParams.get("owner");

  if (!chainId || !marketId || !owner) {
    return NextResponse.json(
      { error: "chainId, marketId, and owner query parameters are required." },
      { status: 400 }
    );
  }

  try {
    const client = createMarketsApiClient({ baseUrl: apiBaseUrl });
    const orders = await client.listMarketOrders({ chainId, marketId, owner });

    return NextResponse.json(orders);
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
    context: { operation: "api/indexer/venue-orders" },
    fallback: "Venue orders request failed.",
  });
}

function readIndexerApiBaseUrl() {
  return (
    process.env.POPCHARTS_INDEXER_API_URL ??
    process.env.NEXT_PUBLIC_POPCHARTS_INDEXER_API_URL
  );
}
