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
    const first = await postMessages({
      body,
      config,
      signal: controller.signal,
    });
    if (first.ok) {
      return (await first.json()) as AnthropicMessageResponse;
    }

    const detail = await first.text().catch(() => "");
    const blocked = inaccessibleDomains(detail);

    // A market may name a source Anthropic's crawler is not allowed to fetch —
    // apnews.com is one, and AP is among the most commonly cited resolution
    // sources there is. Left alone the API rejects the whole request, so a
    // perfectly good market fails review outright rather than being reviewed
    // without that one fetch target. The error names the offending domains, so
    // drop exactly those and retry; web_search still covers the rest.
    if (blocked.length > 0 && Array.isArray(body.tools)) {
      const retried = withoutDomains(body.tools as AnthropicTool[], blocked);
      if (retried) {
        const second = await postMessages({
          body: { ...body, ...(retried.length > 0 ? { tools: retried } : {}) },
          config,
          signal: controller.signal,
        });

        if (second.ok) {
          return (await second.json()) as AnthropicMessageResponse;
        }

        throw new Error(
          `Anthropic returned HTTP ${second.status} after dropping unfetchable domains (${blocked.join(", ")}): ${truncate(await second.text().catch(() => ""), 300)}`,
        );
      }
    }

    // The body is the only place the reason lives. Dropping it leaves a bare
    // status code, which is what made this class of failure unreadable until
    // the request was reproduced by hand.
    throw new Error(
      `Anthropic returned HTTP ${first.status}: ${truncate(detail, 300)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function postMessages({
  body,
  config,
  signal,
}: {
  body: Record<string, unknown>;
  config: Pick<AiReviewConfig, "anthropicApiKey" | "anthropicBaseUrl">;
  signal: AbortSignal;
}) {
  return fetch(new URL("/v1/messages", config.anthropicBaseUrl), {
    body: JSON.stringify(body),
    headers: {
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "x-api-key": config.anthropicApiKey ?? "",
    },
    method: "POST",
    signal,
  });
}

/**
 * The domains named in an "not accessible to our user agent" error. Matched on
 * the quoted list the message carries rather than on the sentence, so a
 * reworded message degrades to "no domains found" and the original error
 * surfaces instead of a wrong retry.
 */
export function inaccessibleDomains(detail: string): string[] {
  if (!detail.includes("not accessible to our user agent")) {
    return [];
  }

  const list = detail.match(/\[([^\]]*)\]/)?.[1];
  if (!list) {
    return [];
  }

  return Array.from(list.matchAll(/'([^']+)'|"([^"]+)"/g))
    .map((match) => match[1] ?? match[2] ?? "")
    .filter(Boolean);
}

/**
 * Rebuilds the tool list without the given fetch domains, returning null when
 * nothing would change. A web_fetch tool left with no domains is dropped
 * rather than sent empty, which the API rejects.
 */
function withoutDomains(tools: AnthropicTool[], blocked: string[]) {
  const lowered = new Set(blocked.map((domain) => domain.toLowerCase()));
  let changed = false;

  const next = tools.flatMap((tool) => {
    const allowed = (tool as { allowed_domains?: string[] }).allowed_domains;
    if (!Array.isArray(allowed)) {
      return [tool];
    }

    const kept = allowed.filter((domain) => !lowered.has(domain.toLowerCase()));
    if (kept.length === allowed.length) {
      return [tool];
    }

    changed = true;
    return kept.length > 0 ? [{ ...tool, allowed_domains: kept }] : [];
  });

  return changed ? next : null;
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
