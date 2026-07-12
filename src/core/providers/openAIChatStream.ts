import type { ChatMessage, MessageAttachment } from "../conversation/types";

type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function attachmentToContentParts(attachment: MessageAttachment): OpenAIContentPart[] {
  if (attachment.kind === "image") {
    return [
      {
        type: "image_url",
        image_url: { url: `data:${attachment.mimeType};base64,${attachment.data}` },
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
 * Converts a conversation's messages to OpenAI wire format. An assistant message only
 * serializes as a `tool_calls` message when every one of its tool calls is immediately
 * answered by a following `tool` message with a matching `tool_call_id` — the shape the
 * API requires. A message that still carries `toolCalls` for UI display (e.g. a
 * previously-completed turn's summarized final answer, persisted without its paired tool
 * results) safely degrades to a plain content message instead of sending an orphaned
 * `tool_calls` entry that the API would reject on the next turn.
 */
export function toOpenAIWireMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((message, index) => {
    if (message.role === "assistant" && message.toolCalls?.length) {
      const followingToolCallIds = new Set<string>();
      for (let next = index + 1; next < messages.length && messages[next].role === "tool"; next += 1) {
        const toolCallId = messages[next].toolCallId;
        if (toolCallId) {
          followingToolCallIds.add(toolCallId);
        }
      }

      const allCallsAnswered = message.toolCalls.every((toolCall) => followingToolCallIds.has(toolCall.id));
      if (allCallsAnswered) {
        return {
          role: "assistant",
          content: message.content || null,
          tool_calls: message.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: "function",
            function: {
              name: toolCall.toolName,
              arguments: toolCall.arguments ?? "{}",
            },
          })),
        };
      }
    }

    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId ?? "",
        content: message.content,
      };
    }

    if (message.attachments?.length) {
      return {
        role: message.role,
        content: [
          ...message.attachments.flatMap(attachmentToContentParts),
          ...(message.content ? [{ type: "text", text: message.content } satisfies OpenAIContentPart] : []),
        ],
      };
    }

    return {
      role: message.role,
      content: message.content,
    };
  });
}

export interface StreamedToolCall {
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface StreamedChatResult {
  content: string;
  toolCalls: StreamedToolCall[];
}

interface StreamChunkToolCallDelta {
  index?: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: StreamChunkToolCallDelta[];
    };
  }>;
}

interface ToolCallAccumulator {
  id?: string;
  name?: string;
  argumentsBuffer: string;
}

export async function streamOpenAIChatCompletion(params: {
  fetcher: typeof fetch;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal?: AbortSignal;
  errorPrefix: string;
  onDelta: (delta: string) => void;
}): Promise<StreamedChatResult> {
  const { fetcher } = params;
  const response = await fetcher(params.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...params.headers,
    },
    body: JSON.stringify(params.body),
    signal: params.signal,
  });

  if (!response.ok) {
    throw new Error(`${params.errorPrefix} with ${response.status}: ${await response.text()}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error(`${params.errorPrefix}: no response stream was returned`);
  }

  const decoder = new TextDecoder();
  const toolCallsByIndex = new Map<number, ToolCallAccumulator>();
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

      let chunk: StreamChunk;
      try {
        chunk = JSON.parse(payload) as StreamChunk;
      } catch {
        continue;
      }

      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) {
        content += delta.content;
        params.onDelta(delta.content);
      }

      for (const toolCallDelta of delta?.tool_calls ?? []) {
        const index = toolCallDelta.index ?? 0;
        const existing = toolCallsByIndex.get(index) ?? { argumentsBuffer: "" };

        if (toolCallDelta.id) {
          existing.id = toolCallDelta.id;
        }
        if (toolCallDelta.function?.name) {
          existing.name = toolCallDelta.function.name;
        }
        if (toolCallDelta.function?.arguments) {
          existing.argumentsBuffer += toolCallDelta.function.arguments;
        }

        toolCallsByIndex.set(index, existing);
      }
    }
  }

  const toolCalls = Array.from(toolCallsByIndex.entries())
    .sort(([a], [b]) => a - b)
    .map(([, accumulated]) => ({
      id: accumulated.id,
      function: { name: accumulated.name, arguments: accumulated.argumentsBuffer },
    }));

  return { content, toolCalls };
}
