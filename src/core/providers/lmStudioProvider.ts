import type { ChatMessage, ToolCallEvent } from "../conversation/types";
import { streamOpenAIChatCompletion, toOpenAIWireMessages, type StreamedToolCall } from "./openAIChatStream";
import { createTauriLocalFetch, shouldUseTauriLocalFetch } from "./tauriLocalFetch";
import type { ChatProvider, ProviderCompleteInput, ProviderModel, ProviderResponse } from "./types";

type Fetcher = typeof fetch;

const DEFAULT_BASE_URL = "http://localhost:1234/v1";

interface LmStudioProviderConfig {
  model: string;
  baseUrl?: string;
  apiKey?: string;
  fetcher?: Fetcher;
}

interface LmStudioModelsResponse {
  data?: Array<{
    id?: string;
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
    serverName: "LM Studio",
    toolName,
    status: "queued",
    risk: toolCallRisk(toolName),
    summary: `Provider requested ${toolName} with ${rawArguments}.`,
    arguments: rawArguments,
  };
}

function createProviderModel(config: LmStudioProviderConfig): ProviderModel {
  return {
    id: config.model,
    name: config.model,
    provider: "LM Studio",
    location: "local",
    capabilities: ["tools", "structured-output"],
    contextTokens: 128000,
  };
}

export function createLmStudioProvider(config: LmStudioProviderConfig): ChatProvider {
  const baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL);
  const fetcher = config.fetcher ?? (shouldUseTauriLocalFetch(baseUrl) ? createTauriLocalFetch() : fetch);
  const model = createProviderModel(config);
  const authHeaders: Record<string, string> = config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {};

  return {
    id: "lmstudio",
    label: "LM Studio",
    model,
    async listModels(): Promise<ProviderModel[]> {
      const response = await fetcher(`${baseUrl}/models`, {
        method: "GET",
        headers: { ...authHeaders },
      });

      if (!response.ok) {
        throw new Error(`LM Studio model fetch failed with ${response.status}: ${await response.text()}`);
      }

      const payload = (await response.json()) as LmStudioModelsResponse;
      return (payload.data ?? [])
        .filter((modelPayload) => Boolean(modelPayload.id))
        .map((modelPayload) => ({
          id: modelPayload.id ?? "",
          name: modelPayload.id ?? "",
          provider: "LM Studio",
          location: "local",
          capabilities: ["tools", "structured-output"],
          contextTokens: 128000,
        }));
    },
    async complete(input: ProviderCompleteInput): Promise<ProviderResponse> {
      const result = await streamOpenAIChatCompletion({
        fetcher,
        url: `${baseUrl}/chat/completions`,
        headers: { ...authHeaders },
        body: {
          model: config.model,
          messages: toOpenAIWireMessages(input.messages),
          stream: true,
          ...(input.tools?.length ? { tools: input.tools } : {}),
        },
        signal: input.signal,
        errorPrefix: "LM Studio provider request failed",
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
