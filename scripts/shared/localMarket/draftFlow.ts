import { parseLabeledJson } from "../json/parseLabeledJson.ts";
import type { GeneratedMarket } from "./generatedMarket.ts";

/**
 * A minimal client for the API's draft flow, used by local-create-market to
 * create markets the way the product does: draft → review → authorized
 * publish (repo ADR 0022). Identity is the dev-header seam the API accepts on
 * local networks only, so this never works against anything but a dev stack.
 */

/** How the generated local markets price and pace themselves. */
const LOCAL_DRAFT_LIQUIDITY_PARAMETER = 5_000;
const LOCAL_DRAFT_OPENING_PROBABILITY = 50;

/**
 * The dev-only owner header the API's dev-header auth mode trusts on local
 * networks (server/src/api/draft-auth.ts names the same literal; the app's
 * drafts client carries its own copy too — three sites, one wire contract).
 */
const DRAFT_OWNER_HEADER = "x-popcharts-draft-owner";

const REVIEW_POLL_INTERVAL_MS = 1_000;
const REVIEW_TIMEOUT_MS = 120_000;

type DraftRecord = {
  id: string;
  status: string;
};

type DraftReviewOutcome = {
  status: string;
  feedback: string[];
};

type PublishParamsResponse = {
  authorization?: { expiry: string; nonce: string; signature: string };
  bypassAiResolution: boolean;
  collateral: string;
  graduationDeadline: string;
  graduationThreshold: string;
  liquidityParameter: string;
  metadata: string;
  metadataHash: string;
  openingProbabilityWad: string;
  resolutionTime: string;
  yesNotBefore: string;
};

/** Maps a generated market onto the draft write model. */
export function draftWriteFrom(
  generatedMarket: GeneratedMarket,
  intendedCreatorAddress: string,
): Record<string, unknown> {
  const { metadata } = generatedMarket;

  return {
    category: metadata.category,
    description: metadata.description,
    graduationWindowSeconds: generatedMarket.graduationSeconds,
    intendedCreatorAddress: intendedCreatorAddress.toLowerCase(),
    liquidityParameter: LOCAL_DRAFT_LIQUIDITY_PARAMETER,
    openingProbability: LOCAL_DRAFT_OPENING_PROBABILITY,
    question: metadata.question,
    resolutionCriteria: metadata.resolutionCriteria,
    ...(metadata.resolutionSources?.length
      ? { resolutionSources: metadata.resolutionSources.join("\n") }
      : {}),
    ...(metadata.resolutionUrl ? { resolutionUrl: metadata.resolutionUrl } : {}),
    resolutionWindowSeconds: generatedMarket.resolutionSeconds,
  };
}

export function createDraftApi({
  apiBaseUrl,
  owner,
}: {
  readonly apiBaseUrl: string;
  readonly owner: string;
}) {
  const headers = {
    "content-type": "application/json",
    [DRAFT_OWNER_HEADER]: owner.toLowerCase(),
  };

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: { ...headers, ...init?.headers },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Draft API ${init?.method ?? "GET"} ${path} failed (${response.status}): ${body.slice(0, 300)}`,
      );
    }

    return (await response.json()) as T;
  }

  return {
    create: (body: Record<string, unknown>) =>
      request<DraftRecord>("/drafts", {
        body: JSON.stringify(body),
        method: "POST",
      }),

    markPublished: (
      draftId: string,
      body: { chainId: number; marketId: string; transactionHash: string },
    ) =>
      request<unknown>(`/drafts/${draftId}/published`, {
        body: JSON.stringify(body),
        method: "POST",
      }),

    publishParams: (draftId: string, creatorAddress: string) =>
      request<PublishParamsResponse>(
        `/drafts/${draftId}/publish-params?creatorAddress=${creatorAddress}`,
        { method: "POST" },
      ),

    submit: (draftId: string) =>
      request<unknown>(`/drafts/${draftId}/submit`, { method: "POST" }),

    /**
     * Polls until the draft leaves in_review. The local stack reviews with
     * the in-process heuristic runner, so this settles in seconds; the
     * timeout exists for stacks whose API is up but whose runner is wedged.
     */
    waitForReview: async (draftId: string): Promise<DraftReviewOutcome> => {
      const deadline = Date.now() + REVIEW_TIMEOUT_MS;

      for (;;) {
        const draft = await request<
          DraftRecord & {
            latestReview?: {
              feedback?: { items?: { title?: string; issue?: string }[] };
            } | null;
          }
        >(`/drafts/${draftId}`);

        if (draft.status !== "in_review" && draft.status !== "editing") {
          const items = draft.latestReview?.feedback?.items ?? [];

          return {
            feedback: items.map(
              (item) => item.title ?? item.issue ?? "(unlabelled feedback)",
            ),
            status: draft.status,
          };
        }

        if (Date.now() > deadline) {
          throw new Error(
            `Draft ${draftId} is still ${draft.status} after ${REVIEW_TIMEOUT_MS / 1_000}s — is the API's draft-review runner alive?`,
          );
        }

        await new Promise((resolve) => setTimeout(resolve, REVIEW_POLL_INTERVAL_MS));
      }
    },
  };
}

/** The publish transaction hash from the protocol helper's parseable line. */
export function parsePublishTransactionHash(stdout: string): string {
  const parsed = parseLabeledJson<{ transactionHash?: string }>(
    stdout,
    "LOCAL_CHAIN_SMOKE_MARKET",
  );

  if (!/^0x[0-9a-fA-F]{64}$/.test(parsed.transactionHash ?? "")) {
    throw new Error("LOCAL_CHAIN_SMOKE_MARKET is missing a transactionHash.");
  }

  return parsed.transactionHash as string;
}
