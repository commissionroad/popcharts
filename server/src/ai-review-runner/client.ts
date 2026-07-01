import type { AiReviewRunnerConfig } from "./config";
import type { MarketReviewRequest, ReviewResult } from "src/ai-review/types";

export class AiReviewServiceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiReviewServiceError";
  }
}

export type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Thin HTTP client for the pure AI Review service. The runner owns queue state
 * and persistence; the service only receives one review request and returns one
 * review result.
 */
export async function reviewMarketWithService({
  config,
  fetchImpl = fetch,
  request,
}: {
  config: Pick<AiReviewRunnerConfig, "requestTimeoutMs" | "serviceUrl">;
  fetchImpl?: FetchFn;
  request: MarketReviewRequest;
}): Promise<ReviewResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const response = await fetchImpl(`${config.serviceUrl}/reviews/market`, {
      body: JSON.stringify(request),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new AiReviewServiceError(
        `AI Review service returned HTTP ${response.status}.`,
        response.status,
      );
    }

    return (await response.json()) as ReviewResult;
  } catch (error) {
    if (error instanceof AiReviewServiceError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new AiReviewServiceError("AI Review service request timed out.");
    }

    throw new AiReviewServiceError(
      error instanceof Error
        ? `AI Review service request failed: ${error.message}`
        : "AI Review service request failed.",
    );
  } finally {
    clearTimeout(timeout);
  }
}
