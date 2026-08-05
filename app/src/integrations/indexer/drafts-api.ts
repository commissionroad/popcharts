import {
  getBuildMarketDraftPublishParamsUrl,
  getCloneMarketDraftUrl,
  getCreateMarketDraftUrl,
  getDeleteMarketDraftUrl,
  getGetMarketDraftReviewCreditUrl,
  getGetMarketDraftUrl,
  getListMarketDraftsUrl,
  getMarkMarketDraftPublishedUrl,
  getSubmitMarketDraftUrl,
  getUpdateMarketDraftUrl,
} from "@popcharts/api-client/drafts";
import type {
  MarketDraft,
  MarketDraftBondShortfall,
  MarketDraftCloneRequest,
  MarketDraftPublished,
  MarketDraftPublishedWrite,
  MarketDraftPublishParams,
  MarketDraftReviewCredit,
  MarketDraftValidationErrors,
  MarketDraftWrite,
} from "@popcharts/api-client/models";

/**
 * Identity header the draft API accepts in dev-header auth mode (ADR 0022
 * decision 8). In local dev the value is the connected wallet address; the
 * production Privy JWT replaces this seam without touching callers.
 */
export const DRAFT_OWNER_HEADER = "x-popcharts-draft-owner";

/** A fetch-compatible function, injectable for tests. */
export type DraftsApiFetch = (url: string, init?: RequestInit) => Promise<Response>;

import { DisplayableError } from "@/lib/error-handling";

/**
 * A draft API failure carrying the service's own message and, for submission
 * validation failures, the field-keyed errors. A `DisplayableError` because
 * the draft API's error bodies are curated user-facing copy — `presentError`
 * passes them through instead of masking them with a fallback.
 */
export class DraftsApiError extends DisplayableError {
  /** Set when the review-credit meter refused the submission (HTTP 402). */
  readonly bondShortfall: MarketDraftBondShortfall | undefined;
  readonly fieldErrors: Record<string, string> | undefined;
  readonly status: number;

  constructor(
    message: string,
    status: number,
    details: {
      bondShortfall?: MarketDraftBondShortfall;
      fieldErrors?: Record<string, string>;
    } = {}
  ) {
    super(message);
    this.name = "DraftsApiError";
    this.status = status;
    if (details.bondShortfall) {
      this.bondShortfall = details.bondShortfall;
    }
    if (details.fieldErrors) {
      this.fieldErrors = details.fieldErrors;
    }
  }
}

export type DraftsApiClient = {
  clone: (body: MarketDraftCloneRequest) => Promise<MarketDraft>;
  create: (body: MarketDraftWrite) => Promise<MarketDraft>;
  /** The wallet's prepaid review-credit position, from the indexed view. */
  credit: (address: string) => Promise<MarketDraftReviewCredit>;
  get: (draftId: string) => Promise<MarketDraft | null>;
  list: () => Promise<MarketDraft[]>;
  markPublished: (
    draftId: string,
    body: MarketDraftPublishedWrite
  ) => Promise<MarketDraftPublished>;
  publishParams: (
    draftId: string,
    creatorAddress?: string
  ) => Promise<MarketDraftPublishParams>;
  remove: (draftId: string) => Promise<void>;
  submit: (draftId: string) => Promise<MarketDraft>;
  update: (draftId: string, body: MarketDraftWrite) => Promise<MarketDraft>;
};

/**
 * Client for the draft endpoints, routed through the same-origin `/api` proxy
 * by default so the browser never needs the indexer URL. Every request
 * carries the identity headers `getAuthHeaders` produces — the Privy bearer
 * token in production, the local-dev owner header on the local stack (see
 * WalletAccountValue.getDraftAuthHeaders) — read per request because bearer
 * tokens refresh.
 */
export function createDraftsApiClient({
  basePath = "/api",
  fetcher = fetch,
  getAuthHeaders,
}: {
  basePath?: string;
  fetcher?: DraftsApiFetch;
  getAuthHeaders: () => Promise<Record<string, string>>;
}): DraftsApiClient {
  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetcher(`${basePath}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(await getAuthHeaders()),
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });

    if (!response.ok) {
      throw await toDraftsApiError(response);
    }

    return (await response.json()) as T;
  };

  return {
    clone: (body) =>
      request<MarketDraft>(getCloneMarketDraftUrl(), {
        body: JSON.stringify(body),
        method: "POST",
      }),
    create: (body) =>
      request<MarketDraft>(getCreateMarketDraftUrl(), {
        body: JSON.stringify(body),
        method: "POST",
      }),
    credit: (address) =>
      request<MarketDraftReviewCredit>(getGetMarketDraftReviewCreditUrl({ address })),
    get: async (draftId) => {
      try {
        return await request<MarketDraft>(getGetMarketDraftUrl(String(draftId)));
      } catch (error) {
        if (error instanceof DraftsApiError && error.status === 404) {
          return null;
        }

        throw error;
      }
    },
    list: () => request<MarketDraft[]>(getListMarketDraftsUrl()),
    markPublished: (draftId, body) =>
      request<MarketDraftPublished>(getMarkMarketDraftPublishedUrl(String(draftId)), {
        body: JSON.stringify(body),
        method: "POST",
      }),
    publishParams: (draftId, creatorAddress) =>
      request<MarketDraftPublishParams>(
        getBuildMarketDraftPublishParamsUrl(
          String(draftId),
          creatorAddress ? { creatorAddress } : undefined
        ),
        { method: "POST" }
      ),
    remove: async (draftId) => {
      await request<string>(getDeleteMarketDraftUrl(String(draftId)), {
        method: "DELETE",
      });
    },
    submit: (draftId) =>
      request<MarketDraft>(getSubmitMarketDraftUrl(String(draftId)), {
        method: "POST",
      }),
    update: (draftId, body) =>
      request<MarketDraft>(getUpdateMarketDraftUrl(String(draftId)), {
        body: JSON.stringify(body),
        method: "PATCH",
      }),
  };
}

async function toDraftsApiError(response: Response): Promise<DraftsApiError> {
  const text = await response.text();
  const parsed = parseBody(text);

  if (isBondShortfall(parsed)) {
    return new DraftsApiError(parsed.message, response.status, {
      bondShortfall: parsed,
    });
  }

  if (isValidationErrors(parsed)) {
    return new DraftsApiError(parsed.message, response.status, {
      fieldErrors: compactFieldErrors(parsed.errors),
    });
  }

  if (typeof parsed === "string" && parsed.length > 0) {
    return new DraftsApiError(parsed, response.status);
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    "error" in parsed &&
    typeof parsed.error === "string"
  ) {
    return new DraftsApiError(parsed.error, response.status);
  }

  return new DraftsApiError(
    `Draft request failed (${response.status}).`,
    response.status
  );
}

function parseBody(text: string): unknown {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isBondShortfall(value: unknown): value is MarketDraftBondShortfall {
  return (
    typeof value === "object" &&
    value !== null &&
    "availableWad" in value &&
    "requiredWad" in value &&
    "runsUsed" in value &&
    "message" in value &&
    typeof value.message === "string"
  );
}

function isValidationErrors(value: unknown): value is MarketDraftValidationErrors {
  return (
    typeof value === "object" &&
    value !== null &&
    "errors" in value &&
    "message" in value &&
    typeof (value as { message: unknown }).message === "string"
  );
}

function compactFieldErrors(
  errors: MarketDraftValidationErrors["errors"]
): Record<string, string> {
  const compact: Record<string, string> = {};

  for (const [field, message] of Object.entries(errors)) {
    if (typeof message === "string") {
      compact[field] = message;
    }
  }

  return compact;
}
