import type { ChatMessage, MessageAttachment, ToolCallEvent } from "../conversation/types";
import type { ChatProvider, ProviderCompleteInput, ProviderModel, ProviderResponse, ProviderToolSchema } from "./types";

type Fetcher = typeof fetch;

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetcher?: Fetcher;
}

interface GeminiModelsResponse {
  models?: Array<{
    name?: string;
    displayName?: string;
    inputTokenLimit?: number;
    supportedGenerationMethods?: string[];
  }>;
}

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: unknown } }
  | { functionResponse: { name: string; response: { result: string } } };

interface GeminiWireContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiStreamChunk {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        functionCall?: { name?: string; args?: unknown };
      }>;
    };
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

function attachmentToParts(attachment: MessageAttachment): GeminiPart[] {
  if (attachment.kind === "image") {
    return [{ inlineData: { mimeType: attachment.mimeType, data: attachment.data } }];
  }
  return [{ text: `Attached file "${attachment.name}":\n\n${attachment.data}` }];
}

/**
 * Gemini function-calling has no call ids — results are matched to calls by function
 * name. Tool-result messages here carry our internal toolCallId, so the conversion
 * resolves each result back to the assistant tool call it answers to recover the name.
 */
export function toGeminiWireContents(messages: ChatMessage[]): {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: GeminiWireContent[];
} {
  const systemParts: string[] = [];
  const contents: GeminiWireContent[] = [];
  const toolNamesByCallId = new Map<string, string>();

  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) {
      toolNamesByCallId.set(toolCall.id, toolCall.toolName);
    }
  }

  const pushParts = (role: "user" | "model", parts: GeminiPart[]) => {
    if (!parts.length) {
      return;
    }
    const previous = contents.at(-1);
    if (previous?.role === role) {
      previous.parts.push(...parts);
      return;
    }
    contents.push({ role, parts });
  };

  for (const message of messages) {
    if (message.role === "system") {
      if (message.content) {
        systemParts.push(message.content);
      }
      continue;
    }

    if (message.role === "tool") {
      const toolName = toolNamesByCallId.get(message.toolCallId ?? "") ?? "unknown_tool";
      pushParts("user", [{ functionResponse: { name: toolName, response: { result: message.content } } }]);
      continue;
    }

    if (message.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (message.content) {
        parts.push({ text: message.content });
      }
      for (const toolCall of message.toolCalls ?? []) {
        let args: unknown = {};
        try {
          args = toolCall.arguments ? JSON.parse(toolCall.arguments) : {};
        } catch {
          args = {};
        }
        parts.push({ functionCall: { name: toolCall.toolName, args } });
      }
      pushParts("model", parts);
      continue;
    }

    const parts: GeminiPart[] = [];
    for (const attachment of message.attachments ?? []) {
      parts.push(...attachmentToParts(attachment));
    }
    if (message.content) {
      parts.push({ text: message.content });
    }
    pushParts("user", parts);
  }

  return {
    systemInstruction: systemParts.length ? { parts: [{ text: systemParts.join("\n\n") }] } : undefined,
    contents,
  };
}

/** Gemini rejects JSON Schema keywords like $schema/additionalProperties — strip them. */
function sanitizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(sanitizeSchema);
  }
  if (schema && typeof schema === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema)) {
      if (key === "$schema" || key === "additionalProperties") {
        continue;
      }
      result[key] = sanitizeSchema(value);
    }
    return result;
  }
  return schema;
}

export function toGeminiTools(tools: ProviderToolSchema[]): Array<{
  functionDeclarations: Array<{ name: string; description?: string; parameters?: unknown }>;
}> {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters ? sanitizeSchema(tool.function.parameters) : undefined,
      })),
    },
  ];
}

function createProviderModel(config: GeminiProviderConfig): ProviderModel {
  return {
    id: config.model,
    name: config.model,
    provider: "Gemini",
    location: "external",
    capabilities: ["tools", "vision", "structured-output", "canvas"],
    contextTokens: 1000000,
  };
}

export function createGeminiProvider(config: GeminiProviderConfig): ChatProvider {
  const fetcher = config.fetcher ?? fetch;
  const baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL);
  const model = createProviderModel(config);

  return {
    id: "gemini",
    label: "Gemini",
    model,
    async listModels(): Promise<ProviderModel[]> {
      const response = await fetcher(`${baseUrl}/models?pageSize=200`, {
        method: "GET",
        headers: { "x-goog-api-key": config.apiKey },
      });

      if (!response.ok) {
        throw new Error(`Gemini model fetch failed with ${response.status}: ${await response.text()}`);
      }

      const payload = (await response.json()) as GeminiModelsResponse;
      return (payload.models ?? [])
        .filter((modelPayload) => modelPayload.supportedGenerationMethods?.includes("generateContent") ?? true)
        .filter((modelPayload) => Boolean(modelPayload.name))
        .map((modelPayload) => {
          const id = (modelPayload.name ?? "").replace(/^models\//, "");
          return {
            id,
            name: modelPayload.displayName ?? id,
            provider: "Gemini",
            location: "external" as const,
            capabilities: ["tools", "vision", "structured-output", "canvas"] as ProviderModel["capabilities"],
            contextTokens: modelPayload.inputTokenLimit ?? 1000000,
          };
        });
    },
    async complete(input: ProviderCompleteInput): Promise<ProviderResponse> {
      const wire = toGeminiWireContents(input.messages);
      const response = await fetcher(
        `${baseUrl}/models/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": config.apiKey,
          },
          body: JSON.stringify({
            ...(wire.systemInstruction ? { systemInstruction: wire.systemInstruction } : {}),
            contents: wire.contents,
            ...(input.tools?.length ? { tools: toGeminiTools(input.tools) } : {}),
          }),
          signal: input.signal,
        },
      );

      if (!response.ok) {
        throw new Error(`Gemini provider request failed with ${response.status}: ${await response.text()}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Gemini provider request failed: no response stream was returned");
      }

      const decoder = new TextDecoder();
      const functionCalls: Array<{ name: string; args: unknown }> = [];
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
          if (!payload || payload === "[DONE]") {
            continue;
          }

          let chunk: GeminiStreamChunk;
          try {
            chunk = JSON.parse(payload) as GeminiStreamChunk;
          } catch {
            continue;
          }

          for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
            if (part.text) {
              content += part.text;
              input.onDelta?.(part.text);
            }
            if (part.functionCall?.name) {
              functionCalls.push({ name: part.functionCall.name, args: part.functionCall.args ?? {} });
            }
          }
        }
      }

      const toolCalls: ToolCallEvent[] = functionCalls.map((functionCall) => {
        const rawArguments = JSON.stringify(functionCall.args ?? {});
        return {
          id: crypto.randomUUID(),
          serverName: "Gemini",
          toolName: functionCall.name,
          status: "queued",
          risk: toolCallRisk(functionCall.name),
          summary: `Provider requested ${functionCall.name} with ${rawArguments}.`,
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
