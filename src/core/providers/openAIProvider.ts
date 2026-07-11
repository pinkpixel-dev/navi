import type { ChatMessage, ToolCallEvent } from "../conversation/types";
import type { ChatProvider, ProviderCompleteInput, ProviderModel, ProviderResponse } from "./types";

type Fetcher = typeof fetch;

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

interface OpenAIProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetcher?: Fetcher;
}

interface OpenAIToolCall {
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: OpenAIToolCall[];
    };
  }>;
}

interface OpenAIModelsResponse {
  data?: Array<{
    id?: string;
  }>;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function toOpenAIMessage(message: ChatMessage) {
  return {
    role: message.role === "tool" ? "user" : message.role,
    content: message.content,
  };
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

function normalizeToolCall(toolCall: OpenAIToolCall): ToolCallEvent {
  const toolName = toolCall.function?.name ?? "unknown_tool";
  const rawArguments = toolCall.function?.arguments ?? "{}";

  return {
    id: toolCall.id ?? crypto.randomUUID(),
    serverName: "OpenAI",
    toolName,
    status: "queued",
    risk: toolCallRisk(toolName),
    summary: `Provider requested ${toolName} with ${rawArguments}.`,
  };
}

function createProviderModel(config: OpenAIProviderConfig): ProviderModel {
  return {
    id: config.model,
    name: config.model,
    provider: "OpenAI",
    location: "external",
    capabilities: ["tools", "structured-output", "canvas"],
    contextTokens: 128000,
  };
}

export function createOpenAIProvider(config: OpenAIProviderConfig): ChatProvider {
  const fetcher = config.fetcher ?? fetch;
  const baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL);
  const model = createProviderModel(config);

  return {
    id: "openai",
    label: "OpenAI",
    model,
    async listModels(): Promise<ProviderModel[]> {
      const response = await fetcher(`${baseUrl}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`OpenAI model fetch failed with ${response.status}: ${await response.text()}`);
      }

      const payload = (await response.json()) as OpenAIModelsResponse;
      return (payload.data ?? [])
        .filter((modelPayload) => Boolean(modelPayload.id))
        .map((modelPayload) => ({
          id: modelPayload.id ?? "",
          name: modelPayload.id ?? "",
          provider: "OpenAI",
          location: "external",
          capabilities: ["tools", "structured-output", "canvas"],
          contextTokens: 128000,
        }));
    },
    async complete(input: ProviderCompleteInput): Promise<ProviderResponse> {
      const response = await fetcher(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: input.messages.map(toOpenAIMessage),
          stream: false,
        }),
        signal: input.signal,
      });

      if (!response.ok) {
        throw new Error(`OpenAI provider request failed with ${response.status}: ${await response.text()}`);
      }

      const payload = (await response.json()) as OpenAIChatResponse;
      const openAIMessage = payload.choices?.[0]?.message;
      const toolCalls = openAIMessage?.tool_calls?.map(normalizeToolCall) ?? [];
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        createdAt: new Date().toISOString(),
        content: openAIMessage?.content ?? "",
        toolCalls,
      };

      return {
        message,
        toolCalls,
      };
    },
  };
}
