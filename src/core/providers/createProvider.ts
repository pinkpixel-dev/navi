import type { ProviderConfig } from "./providerConfig";
import type { ChatProvider } from "./types";
import { createAnthropicProvider } from "./anthropicProvider";
import { createGeminiProvider } from "./geminiProvider";
import { createLmStudioProvider } from "./lmStudioProvider";
import { createOllamaProvider } from "./ollamaProvider";
import { createOpenAICompatibleProvider } from "./openAICompatibleProvider";
import { createOpenAIProvider } from "./openAIProvider";
import { createOpenRouterProvider } from "./openRouterProvider";

interface CreateProviderOptions {
  apiKey?: string | null;
  model: string;
}

/**
 * Builds a ChatProvider for a saved provider config. Returns null when the config
 * is missing something it requires (an endpoint URL or an API key), so callers can
 * show a setup message instead of firing a request that can only fail.
 */
export function createProviderFromConfig(config: ProviderConfig, options: CreateProviderOptions): ChatProvider | null {
  const apiKey = options.apiKey ?? undefined;
  const model = options.model || config.defaultModelId;

  switch (config.type) {
    case "openai-compatible":
      if (!config.baseUrl) {
        return null;
      }
      return createOpenAICompatibleProvider({ baseUrl: config.baseUrl, apiKey, model });
    case "openai":
      if (!apiKey) {
        return null;
      }
      return createOpenAIProvider({ apiKey, model, baseUrl: config.baseUrl });
    case "ollama":
      return createOllamaProvider({ baseUrl: config.baseUrl, apiKey, model });
    case "anthropic":
      if (!apiKey) {
        return null;
      }
      return createAnthropicProvider({ apiKey, model, baseUrl: config.baseUrl });
    case "gemini":
      if (!apiKey) {
        return null;
      }
      return createGeminiProvider({ apiKey, model, baseUrl: config.baseUrl });
    case "openrouter":
      if (!apiKey) {
        return null;
      }
      return createOpenRouterProvider({ apiKey, model, baseUrl: config.baseUrl });
    case "lmstudio":
      return createLmStudioProvider({ baseUrl: config.baseUrl, apiKey, model });
    default:
      return null;
  }
}
