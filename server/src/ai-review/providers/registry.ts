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

export type ReviewProviderRuntimeStatus = {
  capabilities: ReviewProviderCapabilities;
  configured: boolean;
  model?: string;
  name: ReviewProviderName;
  validation: ConfigValidationResult;
};

export const reviewProviders = {
  anthropic: anthropicProvider,
  heuristic: heuristicProvider,
  ollama: ollamaProvider,
} satisfies Record<ReviewProviderName, ReviewProvider>;

export function getReviewProvider(name: ReviewProviderName): ReviewProvider {
  return reviewProviders[name];
}

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

export function getAllReviewProviderStatuses(config: AiReviewConfig) {
  return Object.keys(reviewProviders).map((name) =>
    getReviewProviderStatus({
      config,
      providerName: name as ReviewProviderName,
    }),
  );
}

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
