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

type GeminiContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mime_type: string; data: string }
  | { type: "function_call"; id?: string; name: string; arguments: unknown };

type GeminiFunctionResult = { type: "text"; text: string };

type GeminiInteractionStep =
  | { type: "user_input"; content: GeminiContentBlock[] | string }
  | { type: "model_output"; content: GeminiContentBlock[] }
  | { type: "function_call"; id?: string; name: string; arguments: unknown }
  | { type: "function_result"; call_id?: string; name: string; result: GeminiFunctionResult[] };

interface GeminiStreamStep {
  type?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
  content?: Array<{ type?: string; text?: string }>;
}

interface GeminiStreamDelta {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
  partial_arguments?: string;
}

interface GeminiStreamChunk {
  event_type?: string;
  index?: number;
  step?: GeminiStreamStep;
  delta?: GeminiStreamDelta;
  interaction?: { steps?: GeminiStreamStep[]; outputs?: GeminiStreamStep[] };
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

function attachmentToContentBlocks(attachment: MessageAttachment): GeminiContentBlock[] {
  if (attachment.kind === "image") {
    return [{ type: "image", mime_type: attachment.mimeType, data: attachment.data }];
  }
  return [{ type: "text", text: `Attached file "${attachment.name}":\n\n${attachment.data}` }];
}

/**
 * Gemini Interactions stateless mode expects a chronological list of typed steps.
 * Tool-result messages carry our internal toolCallId, so the conversion resolves
 * each result back to the assistant tool call it answers to recover the provider
 * tool name.
 */
export function toGeminiInteractionInput(messages: ChatMessage[]): {
  systemInstruction?: string;
  input: GeminiInteractionStep[];
} {
  const systemParts: string[] = [];
  const input: GeminiInteractionStep[] = [];
  const toolNamesByCallId = new Map<string, string>();
  const toolResultCallIds = new Set<string>();

  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) {
      toolNamesByCallId.set(toolCall.id, toolCall.toolName);
    }
    if (message.role === "tool" && message.toolCallId) {
      toolResultCallIds.add(message.toolCallId);
    }
  }

  const pushUserInput = (content: GeminiContentBlock[]) => {
    if (!content.length) {
      return;
    }
    input.push({ type: "user_input", content });
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
      input.push({
        type: "function_result",
        call_id: message.toolCallId,
        name: toolName,
        result: [{ type: "text", text: message.content }],
      });
      continue;
    }

    if (message.role === "assistant") {
      if (message.content) {
        input.push({ type: "model_output", content: [{ type: "text", text: message.content }] });
      }
      for (const toolCall of message.toolCalls ?? []) {
        if (!toolResultCallIds.has(toolCall.id)) {
          continue;
        }
        let args: unknown = {};
        try {
          args = toolCall.arguments ? JSON.parse(toolCall.arguments) : {};
        } catch {
          args = {};
        }
        input.push({ type: "function_call", id: toolCall.id, name: toolCall.toolName, arguments: args });
      }
      continue;
    }

    const content: GeminiContentBlock[] = [];
    for (const attachment of message.attachments ?? []) {
      content.push(...attachmentToContentBlocks(attachment));
    }
    if (message.content) {
      content.push({ type: "text", text: message.content });
    }
    pushUserInput(content);
  }

  return {
    systemInstruction: systemParts.length ? systemParts.join("\n\n") : undefined,
    input,
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

export function toGeminiTools(
  tools: ProviderToolSchema[],
): Array<{ type: "function"; name: string; description?: string; parameters?: unknown }> {
  return tools.map((tool) => ({
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters ? sanitizeSchema(tool.function.parameters) : undefined,
  }));
}

function normalizeStreamedArguments(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value ?? {});
}

function stepToFunctionCall(step: GeminiStreamStep): { id?: string; name: string; arguments: string } | null {
  if (step.type !== "function_call" || !step.name) {
    return null;
  }
  return {
    id: step.id,
    name: step.name,
    arguments: normalizeStreamedArguments(step.arguments ?? {}),
  };
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
      const wire = toGeminiInteractionInput(input.messages);
      const response = await fetcher(`${baseUrl}/interactions?alt=sse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": config.apiKey,
        },
        body: JSON.stringify({
          model: config.model,
          input: wire.input,
          store: false,
          stream: true,
          ...(wire.systemInstruction ? { system_instruction: wire.systemInstruction } : {}),
          ...(input.tools?.length ? { tools: toGeminiTools(input.tools) } : {}),
        }),
        signal: input.signal,
      });

      if (!response.ok) {
        throw new Error(`Gemini provider request failed with ${response.status}: ${await response.text()}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Gemini provider request failed: no response stream was returned");
      }

      const decoder = new TextDecoder();
      const functionCalls: Array<{ id?: string; name: string; arguments: unknown }> = [];
      const streamingFunctionCalls = new Map<number, { id?: string; name?: string; arguments: string }>();
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

          if (chunk.event_type === "step.start" && typeof chunk.index === "number" && chunk.step?.type === "function_call") {
            streamingFunctionCalls.set(chunk.index, {
              id: chunk.step.id,
              name: chunk.step.name,
              arguments: normalizeStreamedArguments(chunk.step.arguments ?? ""),
            });
          }

          if (chunk.delta?.type === "text" && chunk.delta.text) {
            content += chunk.delta.text;
            input.onDelta?.(chunk.delta.text);
          }
          if (chunk.delta?.type === "arguments" && typeof chunk.index === "number") {
            const current = streamingFunctionCalls.get(chunk.index);
            if (current) {
              current.arguments += chunk.delta.partial_arguments ?? "";
            }
          }
          if (chunk.delta?.type === "function_call" && chunk.delta.name) {
            functionCalls.push({
              id: chunk.delta.id,
              name: chunk.delta.name,
              arguments: chunk.delta.arguments ?? {},
            });
          }

          for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
            if (part.text) {
              content += part.text;
              input.onDelta?.(part.text);
            }
            if (part.functionCall?.name) {
              functionCalls.push({ name: part.functionCall.name, arguments: part.functionCall.args ?? {} });
            }
          }

          if (
            (chunk.event_type === "interaction.completed" || chunk.event_type === "interaction.complete") &&
            !streamingFunctionCalls.size &&
            !functionCalls.length
          ) {
            for (const step of chunk.interaction?.steps ?? chunk.interaction?.outputs ?? []) {
              const call = stepToFunctionCall(step);
              if (call) {
                functionCalls.push(call);
              }
              if (step.type === "model_output" && !content) {
                for (const part of step.content ?? []) {
                  if (part.type === "text" && part.text) {
                    content += part.text;
                    input.onDelta?.(part.text);
                  }
                }
              }
            }
          }
        }
      }

      for (const call of streamingFunctionCalls.values()) {
        if (call.name) {
          functionCalls.push({ id: call.id, name: call.name, arguments: call.arguments || "{}" });
        }
      }

      const toolCalls: ToolCallEvent[] = functionCalls.map((functionCall) => {
        const rawArguments = normalizeStreamedArguments(functionCall.arguments);
        return {
          id: functionCall.id ?? crypto.randomUUID(),
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
