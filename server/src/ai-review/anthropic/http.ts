import type { AiReviewConfig } from "../config";
import type { MarketReviewRequest } from "../types";
import { buildSystemPrompt, type AnthropicTool } from "./tools";

type AnthropicMessageResponse = {
  content?: AnthropicContentBlock[];
  model?: string;
};

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicWebFetchToolResultBlock
  | AnthropicWebSearchToolResultBlock
  | {
      [key: string]: unknown;
      type: string;
    };

export type AnthropicTextBlock = {
  citations?: AnthropicCitation[];
  text?: string;
  type: "text";
};

type AnthropicCitation = {
  cited_text?: string;
  title?: string;
  type?: string;
  url?: string;
};

type AnthropicWebSearchToolResultBlock = {
  content?: AnthropicWebSearchResult[] | AnthropicToolError;
  type: "web_search_tool_result";
};

type AnthropicWebSearchResult = {
  page_age?: string;
  title?: string;
  type?: "web_search_result";
  url?: string;
};

type AnthropicWebFetchToolResultBlock = {
  content?: AnthropicToolError | AnthropicWebFetchResult;
  type: "web_fetch_tool_result";
};

export type AnthropicWebFetchResult = {
  content?: {
    title?: string;
    type?: string;
  };
  retrieved_at?: string;
  type?: "web_fetch_result";
  url?: string;
};

type AnthropicToolError = {
  error_code?: string;
  type?: string;
};

export async function callAnthropicMessages({
  config,
  model,
  request,
  tools,
}: {
  config: Pick<
    AiReviewConfig,
    | "anthropicApiKey"
    | "anthropicBaseUrl"
    | "anthropicMaxOutputTokens"
    | "requestTimeoutMs"
  >;
  model: string;
  request: MarketReviewRequest;
  tools: AnthropicTool[];
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  const body: Record<string, unknown> = {
    max_tokens: config.anthropicMaxOutputTokens,
    messages: [
      {
        content: JSON.stringify(
          {
            internetAccess: request.options?.internetAccess,
            market: request.context ?? {},
            metadata: request.metadata,
          },
          null,
          2,
        ),
        role: "user",
      },
    ],
    model,
    system: buildSystemPrompt(),
    temperature: 0,
  };

  if (tools.length > 0) {
    body.tools = tools;
  }

  try {
    const response = await fetch(
      new URL("/v1/messages", config.anthropicBaseUrl),
      {
        body: JSON.stringify(body),
        headers: {
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "x-api-key": config.anthropicApiKey ?? "",
        },
        method: "POST",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`Anthropic returned HTTP ${response.status}.`);
    }

    return (await response.json()) as AnthropicMessageResponse;
  } finally {
    clearTimeout(timeout);
  }
}
