import type { AiReviewConfig } from "../config";

/**
 * Transport and response types for the OpenAI Responses API.
 *
 * Every field is optional and loosely typed on purpose: this is untrusted
 * output crossing a network boundary, and the parsers in `evidence.ts` narrow
 * it rather than trusting the shape. Verified against the Responses API web
 * search guide (tool `{"type":"web_search"}`, sources requested through
 * `include: ["web_search_call.action.sources"]`).
 */

/** One `url_citation` annotation on a chunk of the model's answer. */
export type OpenAiAnnotation = {
  title?: string;
  type?: string;
  url?: string;
};

/** One content block of a `message` output item. */
export type OpenAiContentBlock = {
  annotations?: OpenAiAnnotation[];
  text?: string;
  type?: string;
};

/** One entry of the output array: a search call, a message, or anything else. */
export type OpenAiOutputItem = {
  action?: {
    query?: string;
    sources?: unknown[];
    type?: string;
  };
  content?: OpenAiContentBlock[];
  status?: string;
  type?: string;
};

export type OpenAiResponse = {
  model?: string;
  output?: OpenAiOutputItem[];
};

/**
 * Calls the Responses API for one review.
 *
 * `include` is what makes this provider's evidence trail complete: without it
 * the response carries only the citations the model chose, and the URLs it
 * consulted but did not cite never appear. Web search is offered only when the
 * request's internet-access mode allows it, so an `off` review cannot reach
 * the network no matter what the market text asks for.
 */
export async function callOpenAiResponses({
  config,
  input,
  model,
  webSearchEnabled,
}: {
  config: Pick<
    AiReviewConfig,
    | "openaiApiKey"
    | "openaiBaseUrl"
    | "openaiMaxOutputTokens"
    | "requestTimeoutMs"
  >;
  input: string;
  model: string;
  webSearchEnabled: boolean;
}): Promise<OpenAiResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  const body: Record<string, unknown> = {
    input,
    max_output_tokens: config.openaiMaxOutputTokens,
    model,
  };

  if (webSearchEnabled) {
    body.include = ["web_search_call.action.sources"];
    body.tools = [{ type: "web_search" }];
  }

  try {
    const response = await fetch(
      new URL("/v1/responses", config.openaiBaseUrl),
      {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${config.openaiApiKey ?? ""}`,
          "content-type": "application/json",
        },
        method: "POST",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      // The body carries the reason (bad key, exhausted quota, unknown model).
      // Dropping it would leave a bare status code as the only diagnostic —
      // the same mistake that made an Anthropic 400 unreadable until it was
      // curled by hand.
      throw new Error(
        `OpenAI returned HTTP ${response.status}: ${truncate(await response.text().catch(() => ""), 300)}`,
      );
    }

    return (await response.json()) as OpenAiResponse;
  } finally {
    clearTimeout(timeout);
  }
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
