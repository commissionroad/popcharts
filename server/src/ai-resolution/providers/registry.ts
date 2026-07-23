import type { AiResolutionConfig } from "../config";
import type {
  ConfigValidationResult,
  ResolutionModelProviderName,
} from "../types";
import { anthropicProvider } from "./anthropic";
import { claudeCliProvider } from "./claude-cli";
import { heuristicProvider } from "./heuristic";
import { ollamaProvider } from "./ollama";
import type { ResolutionProvider } from "./types";

/**
 * Every resolution backend, keyed by name. `satisfies Record<...>` makes a
 * missing implementation a compile error — adding a provider name to
 * ResolutionModelProviderName forces a registry entry.
 */
export const resolutionProviders = {
  anthropic: anthropicProvider,
  "claude-cli": claudeCliProvider,
  heuristic: heuristicProvider,
  ollama: ollamaProvider,
} satisfies Record<ResolutionModelProviderName, ResolutionProvider>;

export function getResolutionProvider(
  name: ResolutionModelProviderName,
): ResolutionProvider {
  return resolutionProviders[name];
}

export function getResolutionProviderStatus({
  config,
  providerName = config.provider,
}: {
  config: AiResolutionConfig;
  providerName?: ResolutionModelProviderName;
}): {
  available: boolean;
  name: ResolutionModelProviderName;
} & ConfigValidationResult {
  const validation = resolutionProviders[providerName].validateConfig(config);

  return {
    available: validation.errors.length === 0,
    errors: validation.errors,
    name: providerName,
    warnings: validation.warnings,
  };
}
