import type {
  MarketResolutionRequest,
  ResolutionResult,
} from "src/ai-resolution/types";

import type { AiResolutionRunnerConfig } from "./config";

/**
 * Error type every service-call failure is normalized to, carrying the HTTP
 * status when one was received so callers can tell rejections from timeouts and
 * transport failures.
 */
export class AiResolutionServiceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiResolutionServiceError";
  }
}

/** fetch-compatible signature, injectable so tests can stub the service. */
export type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Thin HTTP client for the pure AI Resolution service. The runner owns queue
 * state and persistence; the service only receives one resolution request and
 * returns one resolution result.
 */
export async function resolveMarketWithService({
  config,
  fetchImpl = fetch,
  request,
}: {
  config: Pick<AiResolutionRunnerConfig, "requestTimeoutMs" | "serviceUrl">;
  fetchImpl?: FetchFn;
  request: MarketResolutionRequest;
}): Promise<ResolutionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const response = await fetchImpl(
      `${config.serviceUrl}/resolutions/market`,
      {
        body: JSON.stringify(request),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new AiResolutionServiceError(
        `AI Resolution service returned HTTP ${response.status}.`,
        response.status,
      );
    }

    return (await response.json()) as ResolutionResult;
  } catch (error) {
    if (error instanceof AiResolutionServiceError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new AiResolutionServiceError(
        "AI Resolution service request timed out.",
      );
    }

    throw new AiResolutionServiceError(
      error instanceof Error
        ? `AI Resolution service request failed: ${error.message}`
        : "AI Resolution service request failed.",
    );
  } finally {
    clearTimeout(timeout);
  }
}
