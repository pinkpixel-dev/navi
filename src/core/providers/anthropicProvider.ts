import type { ChatMessage, MessageAttachment, ToolCallEvent } from "../conversation/types";
import type { ChatProvider, ProviderCompleteInput, ProviderModel, ProviderResponse, ProviderToolSchema } from "./types";

type Fetcher = typeof fetch;

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 8192;

interface AnthropicProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens?: number;
  fetcher?: Fetcher;
}

interface AnthropicModelsResponse {
  data?: Array<{
    id?: string;
    display_name?: string;
  }>;
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicWireMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
}

interface AnthropicStreamEvent {
  type?: string;
  content_block?: {
    type?: string;
    id?: string;
    name?: string;
  };
  index?: number;
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
  };
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

function attachmentToContentBlocks(attachment: MessageAttachment): AnthropicContentBlock[] {
  if (attachment.kind === "image") {
    return [
      {
        type: "image",
        source: { type: "base64", media_type: attachment.mimeType, data: attachment.data },
      },
    ];
  }

  return [
    {
      type: "text",
      text: `Attached file "${attachment.name}":\n\n${attachment.data}`,
    },
  ];
}

/**
 * Converts conversation messages to the Anthropic Messages API wire format.
 * System messages become the top-level `system` string, tool-role messages become
 * `tool_result` blocks inside user messages, and an assistant message's tool calls
 * only serialize as `tool_use` blocks when every call has a following tool result
 * (mirroring the OpenAI wire conversion's orphaned-tool-call protection).
 */
export function toAnthropicWireMessages(messages: ChatMessage[]): {
  system?: string;
  messages: AnthropicWireMessage[];
} {
  const systemParts: string[] = [];
  const wireMessages: AnthropicWireMessage[] = [];

  const pushBlocks = (role: "user" | "assistant", blocks: AnthropicContentBlock[]) => {
    if (!blocks.length) {
      return;
    }
    const previous = wireMessages.at(-1);
    if (previous?.role === role) {
      previous.content.push(...blocks);
      return;
    }
    wireMessages.push({ role, content: blocks });
  };

  messages.forEach((message, index) => {
    if (message.role === "system") {
      if (message.content) {
        systemParts.push(message.content);
      }
      return;
    }

    if (message.role === "tool") {
      pushBlocks("user", [
        {
          type: "tool_result",
          tool_use_id: message.toolCallId ?? "",
          content: message.content,
        },
      ]);
      return;
    }

    if (message.role === "assistant") {
      const blocks: AnthropicContentBlock[] = [];
      if (message.content) {
        blocks.push({ type: "text", text: message.content });
      }

      if (message.toolCalls?.length) {
        const followingToolCallIds = new Set<string>();
        for (let next = index + 1; next < messages.length && messages[next].role === "tool"; next += 1) {
          const toolCallId = messages[next].toolCallId;
          if (toolCallId) {
            followingToolCallIds.add(toolCallId);
          }
        }

        const allCallsAnswered = message.toolCalls.every((toolCall) => followingToolCallIds.has(toolCall.id));
        if (allCallsAnswered) {
          for (const toolCall of message.toolCalls) {
            let input: unknown = {};
            try {
              input = toolCall.arguments ? JSON.parse(toolCall.arguments) : {};
            } catch {
              input = {};
            }
            blocks.push({ type: "tool_use", id: toolCall.id, name: toolCall.toolName, input });
          }
        }
      }

      pushBlocks("assistant", blocks);
      return;
    }

    const blocks: AnthropicContentBlock[] = [];
    for (const attachment of message.attachments ?? []) {
      blocks.push(...attachmentToContentBlocks(attachment));
    }
    if (message.content) {
      blocks.push({ type: "text", text: message.content });
    }
    pushBlocks("user", blocks);
  });

  return {
    system: systemParts.length ? systemParts.join("\n\n") : undefined,
    messages: wireMessages,
  };
}

export function toAnthropicTools(tools: ProviderToolSchema[]): Array<{
  name: string;
  description?: string;
  input_schema: unknown;
}> {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters ?? { type: "object", properties: {} },
  }));
}

interface ToolUseAccumulator {
  id: string;
  name: string;
  inputBuffer: string;
}

function createProviderModel(config: AnthropicProviderConfig): ProviderModel {
  return {
    id: config.model,
    name: config.model,
    provider: "Anthropic",
    location: "external",
    capabilities: ["tools", "vision", "structured-output", "canvas"],
    contextTokens: 200000,
  };
}

export function createAnthropicProvider(config: AnthropicProviderConfig): ChatProvider {
  const fetcher = config.fetcher ?? fetch;
  const baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL);
  const model = createProviderModel(config);
  const headers = {
    "x-api-key": config.apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-dangerous-direct-browser-access": "true",
  };

  return {
    id: "anthropic",
    label: "Anthropic",
    model,
    async listModels(): Promise<ProviderModel[]> {
      const response = await fetcher(`${baseUrl}/models`, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        throw new Error(`Anthropic model fetch failed with ${response.status}: ${await response.text()}`);
      }

      const payload = (await response.json()) as AnthropicModelsResponse;
      return (payload.data ?? [])
        .filter((modelPayload) => Boolean(modelPayload.id))
        .map((modelPayload) => ({
          id: modelPayload.id ?? "",
          name: modelPayload.display_name ?? modelPayload.id ?? "",
          provider: "Anthropic",
          location: "external",
          capabilities: ["tools", "vision", "structured-output", "canvas"],
          contextTokens: 200000,
        }));
    },
    async complete(input: ProviderCompleteInput): Promise<ProviderResponse> {
      const wire = toAnthropicWireMessages(input.messages);
      const response = await fetcher(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
          stream: true,
          ...(wire.system ? { system: wire.system } : {}),
          messages: wire.messages,
          ...(input.tools?.length ? { tools: toAnthropicTools(input.tools) } : {}),
        }),
        signal: input.signal,
      });

      if (!response.ok) {
        throw new Error(`Anthropic provider request failed with ${response.status}: ${await response.text()}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Anthropic provider request failed: no response stream was returned");
      }

      const decoder = new TextDecoder();
      const toolUsesByIndex = new Map<number, ToolUseAccumulator>();
      let content = "";
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) {
            continue;
          }

          const payload = line.slice("data:".length).trim();
          if (!payload) {
            continue;
          }

          let event: AnthropicStreamEvent;
          try {
            event = JSON.parse(payload) as AnthropicStreamEvent;
          } catch {
            continue;
          }

          if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
            toolUsesByIndex.set(event.index ?? 0, {
              id: event.content_block.id ?? crypto.randomUUID(),
              name: event.content_block.name ?? "unknown_tool",
              inputBuffer: "",
            });
            continue;
          }

          if (event.type === "content_block_delta") {
            if (event.delta?.type === "text_delta" && event.delta.text) {
              content += event.delta.text;
              input.onDelta?.(event.delta.text);
            } else if (event.delta?.type === "input_json_delta" && event.delta.partial_json) {
              const accumulator = toolUsesByIndex.get(event.index ?? 0);
              if (accumulator) {
                accumulator.inputBuffer += event.delta.partial_json;
              }
            }
          }
        }
      }

      const toolCalls: ToolCallEvent[] = Array.from(toolUsesByIndex.entries())
        .sort(([a], [b]) => a - b)
        .map(([, accumulated]) => {
          const rawArguments = accumulated.inputBuffer || "{}";
          return {
            id: accumulated.id,
            serverName: "Anthropic",
            toolName: accumulated.name,
            status: "queued",
            risk: toolCallRisk(accumulated.name),
            summary: `Provider requested ${accumulated.name} with ${rawArguments}.`,
            arguments: rawArguments,
          };
        });

      const message: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        createdAt: new Date().toISOString(),
        content,
        toolCalls,
      };

      return {
        message,
        toolCalls,
      };
    },
  };
}
