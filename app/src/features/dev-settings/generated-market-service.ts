import { parseMarketMetadata } from "@/integrations/contracts/market-metadata";
import type { GeneratedLocalMarket } from "@/integrations/local-market-generator/types";
import { DisplayableError } from "@/lib/error-handling";
import { isRecord } from "@/lib/is-record";

const GENERATED_MARKET_URL = "/api/dev/generated-market";

/**
 * Asks the local-dev route for one generated market. Rejects with the route's
 * own message when it declines — the tool only exists in dev builds, so "not
 * enabled" is the answer a misconfigured stack should read verbatim.
 */
export async function fetchGeneratedLocalMarket(): Promise<GeneratedLocalMarket> {
  const response = await fetch(GENERATED_MARKET_URL, {
    headers: { accept: "application/json" },
  });
  const body = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new DisplayableError(
      isRecord(body) && typeof body.error === "string"
        ? body.error
        : "The market generator could not be reached."
    );
  }

  return parseGeneratedLocalMarket(body);
}

function parseGeneratedLocalMarket(value: unknown): GeneratedLocalMarket {
  if (!isRecord(value)) {
    throw new Error("The market generator returned a malformed market.");
  }

  return {
    graduationAt: readInstant(value.graduationAt, "graduationAt"),
    // The protocol's own validator, so this tool cannot accept a metadata shape
    // the create form would fail to serialize.
    metadata: parseMarketMetadata(value.metadata),
    resolutionAt: readInstant(value.resolutionAt, "resolutionAt"),
  };
}

function readInstant(value: unknown, field: string): string {
  if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
    throw new Error(`The market generator returned no usable ${field}.`);
  }

  return value;
}
