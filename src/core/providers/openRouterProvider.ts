import type { ChatMessage, ToolCallEvent } from "../conversation/types";
import { streamOpenAIChatCompletion, toOpenAIWireMessages, type StreamedToolCall } from "./openAIChatStream";
import type { ChatProvider, ProviderCompleteInput, ProviderModel, ProviderResponse } from "./types";

type Fetcher = typeof fetch;

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

interface OpenRouterProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetcher?: Fetcher;
}

interface OpenRouterModelsResponse {
  data?: Array<{
    id?: string;
    name?: string;
    context_length?: number;
  }>;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function toolCallRisk(toolName: string): ToolCallEvent["risk"] {
  const lowerName = toolName.toLowerCase();

  if (lowerName.includes("delete") || lowerName.includes("remove")) {
    return "destructive";
  }

  if (lowerName.includes("create") || lowerName.includes("write") || lowerName.includes("update")) {
    return "write";
  }

  return "read";
}

function normalizeToolCall(toolCall: StreamedToolCall): ToolCallEvent {
  const toolName = toolCall.function?.name ?? "unknown_tool";
  const rawArguments = toolCall.function?.arguments ?? "{}";

  return {
    id: toolCall.id ?? crypto.randomUUID(),
    serverName: "OpenRouter",
    toolName,
    status: "queued",
    risk: toolCallRisk(toolName),
    summary: `Provider requested ${toolName} with ${rawArguments}.`,
    arguments: rawArguments,
  };
}

function createProviderModel(config: OpenRouterProviderConfig): ProviderModel {
  return {
    id: config.model,
    name: config.model,
    provider: "OpenRouter",
    location: "external",
    capabilities: ["tools", "structured-output", "canvas"],
    contextTokens: 128000,
  };
}

const attributionHeaders = {
  "HTTP-Referer": "https://pinkpixel.dev",
  "X-Title": "Navi",
};

export function createOpenRouterProvider(config: OpenRouterProviderConfig): ChatProvider {
  const fetcher = config.fetcher ?? fetch;
  const baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL);
  const model = createProviderModel(config);

  return {
    id: "openrouter",
    label: "OpenRouter",
    model,
    async listModels(): Promise<ProviderModel[]> {
      const response = await fetcher(`${baseUrl}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`OpenRouter model fetch failed with ${response.status}: ${await response.text()}`);
      }

      const payload = (await response.json()) as OpenRouterModelsResponse;
      return (payload.data ?? [])
        .filter((modelPayload) => Boolean(modelPayload.id))
        .map((modelPayload) => ({
          id: modelPayload.id ?? "",
          name: modelPayload.name ?? modelPayload.id ?? "",
          provider: "OpenRouter",
          location: "external",
          capabilities: ["tools", "structured-output", "canvas"],
          contextTokens: modelPayload.context_length ?? 128000,
        }));
    },
    async complete(input: ProviderCompleteInput): Promise<ProviderResponse> {
      const result = await streamOpenAIChatCompletion({
        fetcher,
        url: `${baseUrl}/chat/completions`,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          ...attributionHeaders,
        },
        body: {
          model: config.model,
          messages: toOpenAIWireMessages(input.messages),
          stream: true,
          ...(input.tools?.length ? { tools: input.tools } : {}),
        },
        signal: input.signal,
        errorPrefix: "OpenRouter provider request failed",
        onDelta: (delta) => input.onDelta?.(delta),
      });

      const toolCalls = result.toolCalls.map(normalizeToolCall);
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        createdAt: new Date().toISOString(),
        content: result.content,
        toolCalls,
      };

      return {
        message,
        toolCalls,
      };
    },
  };
}
