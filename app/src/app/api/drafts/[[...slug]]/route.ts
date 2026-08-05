import { NextResponse } from "next/server";

import { DRAFT_OWNER_HEADER } from "@/integrations/indexer/drafts-api";
import { presentError } from "@/lib/error-handling";

/**
 * Same-origin proxy for the indexer's draft endpoints, so the create flow and
 * studio can call them from the browser using the server-side indexer URL
 * (local dev only exposes the non-public variable — see the portfolio proxy).
 * Forwards the method, JSON body, and the draft-owner identity header, and
 * relays the API's status and body untouched so error copy stays the API's.
 */
type RouteContext = {
  params: Promise<{ slug?: string[] }>;
};

export async function GET(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function PATCH(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return proxy(request, context);
}

async function proxy(request: Request, context: RouteContext) {
  const apiBaseUrl = readIndexerApiBaseUrl();

  if (!apiBaseUrl) {
    return NextResponse.json(
      { error: "POPCHARTS_INDEXER_API_URL is required to work with drafts." },
      { status: 500 }
    );
  }

  const { slug = [] } = await context.params;
  const search = new URL(request.url).search;
  const target = `${apiBaseUrl.replace(/\/$/, "")}/drafts${slug.length > 0 ? `/${slug.join("/")}` : ""}${search}`;
  const owner = request.headers.get(DRAFT_OWNER_HEADER);
  const authorization = request.headers.get("authorization");
  const body = request.method === "GET" ? undefined : await request.text();

  try {
    const response = await fetch(target, {
      ...(body ? { body } : {}),
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
        // Whichever identity the client sent passes through untouched: the
        // Privy bearer token (verified by the API) or the local dev header.
        ...(authorization ? { authorization } : {}),
        ...(owner ? { [DRAFT_OWNER_HEADER]: owner } : {}),
      },
      method: request.method,
    });
    const text = await response.text();

    return new NextResponse(text, {
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
      },
      status: response.status,
    });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 502 });
  }
}

function getErrorMessage(error: unknown) {
  // Log the raw failure server-side; return only well-formed copy to the client.
  return presentError(error, {
    context: { operation: "api/drafts-proxy" },
    fallback: "The draft service is unreachable.",
  });
}

function readIndexerApiBaseUrl() {
  return (
    process.env.POPCHARTS_INDEXER_API_URL ??
    process.env.NEXT_PUBLIC_POPCHARTS_INDEXER_API_URL
  );
}
