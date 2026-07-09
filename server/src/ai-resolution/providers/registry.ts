import type {
  AiResolutionConfig,
  ResolutionModelProviderName,
} from "../config";
import type { ConfigValidationResult } from "../types";
import { heuristicProvider } from "./heuristic";
import { ollamaProvider } from "./ollama";
import type { ResolutionProvider } from "./types";

/**
 * Registry of implemented resolution providers. The heuristic and local Ollama
 * backends ship first; the `anthropic` model backend lands next and slots in
 * here, at which point this becomes a total
 * `satisfies Record<ResolutionModelProviderName, ...>`.
 */
export const resolutionProviders: Partial<
  Record<ResolutionModelProviderName, ResolutionProvider>
> = {
  heuristic: heuristicProvider,
  ollama: ollamaProvider,
};

export function getResolutionProvider(
  name: ResolutionModelProviderName,
): ResolutionProvider {
  const provider = resolutionProviders[name];
  if (!provider) {
    throw new Error(`Resolution provider "${name}" is not implemented yet.`);
  }

  return provider;
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
  const provider = resolutionProviders[providerName];
  if (!provider) {
    return {
      available: false,
      errors: [`Resolution provider "${providerName}" is not implemented yet.`],
      name: providerName,
      warnings: [],
    };
  }

  const validation = provider.validateConfig(config);
  return {
    available: validation.errors.length === 0,
    errors: validation.errors,
    name: providerName,
    warnings: validation.warnings,
  };
}
