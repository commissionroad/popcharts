import type { AiReviewConfig } from "../config";
import type {
  ConfigValidationResult,
  ReviewProviderCapabilities,
  ReviewProviderName,
} from "../types";
import { anthropicProvider } from "./anthropic";
import { heuristicProvider } from "./heuristic";
import { ollamaProvider } from "./ollama";
import type { ReviewProvider } from "./types";

/**
 * A provider's health as reported by the service's status endpoint:
 * capabilities, the model it would use, and whether its config validates.
 */
export type ReviewProviderRuntimeStatus = {
  capabilities: ReviewProviderCapabilities;
  configured: boolean;
  model?: string;
  name: ReviewProviderName;
  validation: ConfigValidationResult;
};

/**
 * The single registry of review backends. The satisfies clause makes adding a
 * ReviewProviderName without a matching implementation a compile error.
 */
export const reviewProviders = {
  anthropic: anthropicProvider,
  heuristic: heuristicProvider,
  ollama: ollamaProvider,
} satisfies Record<ReviewProviderName, ReviewProvider>;

/** Looks up a provider by name; total over ReviewProviderName, never throws. */
export function getReviewProvider(name: ReviewProviderName): ReviewProvider {
  return reviewProviders[name];
}

/**
 * Snapshots one provider's runtime status (defaulting to the configured
 * provider), where "configured" means its validation produced no errors.
 */
export function getReviewProviderStatus({
  config,
  providerName = config.provider,
}: {
  config: AiReviewConfig;
  providerName?: ReviewProviderName;
}): ReviewProviderRuntimeStatus {
  const provider = getReviewProvider(providerName);
  const validation = provider.validateConfig(config);

  return {
    capabilities: provider.capabilities,
    configured: validation.errors.length === 0,
    model: modelForProvider(config, providerName),
    name: providerName,
    validation,
  };
}

/** Status of every registered provider, for the service's status endpoint. */
export function getAllReviewProviderStatuses(config: AiReviewConfig) {
  return Object.keys(reviewProviders).map((name) =>
    getReviewProviderStatus({
      config,
      providerName: name as ReviewProviderName,
    }),
  );
}

/**
 * The default model a provider would run with under the current config;
 * undefined for the heuristic provider, which has no model.
 */
export function modelForProvider(
  config: AiReviewConfig,
  providerName: ReviewProviderName,
) {
  if (providerName === "anthropic") {
    return config.anthropicModel;
  }

  if (providerName === "ollama") {
    return config.ollamaModel;
  }

  return undefined;
}
