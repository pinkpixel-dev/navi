import type { ChatMessage, ToolCallEvent } from "../conversation/types";
import type { ChatProvider, ProviderCompleteInput, ProviderModel, ProviderResponse } from "./types";

type Fetcher = typeof fetch;

interface OpenAICompatibleProviderConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  fetcher?: Fetcher;
}

interface CompatibleToolCall {
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface CompatibleChatResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: CompatibleToolCall[];
    };
  }>;
}

interface CompatibleModelsResponse {
  data?: Array<{
    id?: string;
  }>;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function toCompatibleMessage(message: ChatMessage) {
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

function normalizeToolCall(toolCall: CompatibleToolCall): ToolCallEvent {
  const toolName = toolCall.function?.name ?? "unknown_tool";
  const rawArguments = toolCall.function?.arguments ?? "{}";

  return {
    id: toolCall.id ?? crypto.randomUUID(),
    serverName: "OpenAI-compatible",
    toolName,
    status: "queued",
    risk: toolCallRisk(toolName),
    summary: `Provider requested ${toolName} with ${rawArguments}.`,
  };
}

function createProviderModel(config: OpenAICompatibleProviderConfig): ProviderModel {
  return {
    id: config.model,
    name: config.model,
    provider: "OpenAI-compatible",
    location: "external",
    capabilities: ["tools", "structured-output", "canvas"],
    contextTokens: 128000,
  };
}

export function createOpenAICompatibleProvider(config: OpenAICompatibleProviderConfig): ChatProvider {
  const fetcher = config.fetcher ?? fetch;
  const model = createProviderModel(config);

  return {
    id: "openai-compatible",
    label: "OpenAI-compatible",
    model,
    async listModels(): Promise<ProviderModel[]> {
      const response = await fetcher(`${normalizeBaseUrl(config.baseUrl)}/models`, {
        method: "GET",
        headers: {
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
      });

      if (!response.ok) {
        throw new Error(`OpenAI-compatible model fetch failed with ${response.status}: ${await response.text()}`);
      }

      const payload = (await response.json()) as CompatibleModelsResponse;
      return (payload.data ?? [])
        .filter((modelPayload) => Boolean(modelPayload.id))
        .map((modelPayload) => ({
          id: modelPayload.id ?? "",
          name: modelPayload.id ?? "",
          provider: "OpenAI-compatible",
          location: "external",
          capabilities: ["tools", "structured-output", "canvas"],
          contextTokens: 128000,
        }));
    },
    async complete(input: ProviderCompleteInput): Promise<ProviderResponse> {
      const response = await fetcher(`${normalizeBaseUrl(config.baseUrl)}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          messages: input.messages.map(toCompatibleMessage),
          stream: false,
        }),
        signal: input.signal,
      });

      if (!response.ok) {
        throw new Error(`OpenAI-compatible provider request failed with ${response.status}: ${await response.text()}`);
      }

      const payload = (await response.json()) as CompatibleChatResponse;
      const compatibleMessage = payload.choices?.[0]?.message;
      const toolCalls = compatibleMessage?.tool_calls?.map(normalizeToolCall) ?? [];
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        createdAt: new Date().toISOString(),
        content: compatibleMessage?.content ?? "",
        toolCalls,
      };

      return {
        message,
        toolCalls,
      };
    },
  };
}
