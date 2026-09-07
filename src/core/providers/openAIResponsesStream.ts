import type { ChatMessage, MessageAttachment } from "../conversation/types";
import type { ProviderToolSchema } from "./types";

export interface ResponsesInputTextPart {
  type: "input_text";
  text: string;
}

export interface ResponsesInputImagePart {
  type: "input_image";
  image_url: string;
}

export type ResponsesContentPart = ResponsesInputTextPart | ResponsesInputImagePart;

export type ResponsesInputItem =
  | {
      role: "user" | "assistant" | "developer" | "system";
      content: string | ResponsesContentPart[];
    }
  | {
      type: "function_call";
      call_id: string;
      name: string;
      arguments: string;
    }
  | {
      type: "function_call_output";
      call_id: string;
      output: string;
    };

function attachmentToResponsesContentParts(attachment: MessageAttachment): ResponsesContentPart[] {
  if (attachment.kind === "image") {
    return [
      {
        type: "input_image",
        image_url: `data:${attachment.mimeType};base64,${attachment.data}`,
      },
    ];
  }

  return [
    {
      type: "input_text",
      text: `Attached file "${attachment.name}":\n\n${attachment.data}`,
    },
  ];
}

/**
 * Converts conversation messages into Responses API input items.
 *
 * In the Responses API (/v1/responses), messages, function calls, and function
 * call outputs are separate items in the input array. An assistant message with
 * tool calls is only serialized with function_call items when each call is
 * immediately answered by a corresponding tool result with matching toolCallId.
 */
export function toOpenAIResponsesInput(messages: ChatMessage[]): ResponsesInputItem[] {
  const items: ResponsesInputItem[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];

    if (message.role === "system") {
      items.push({
        role: "developer",
        content: message.content,
      });
      continue;
    }

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
        if (message.content) {
          items.push({
            role: "assistant",
            content: message.content,
          });
        }
        for (const toolCall of message.toolCalls) {
          items.push({
            type: "function_call",
            call_id: toolCall.id,
            name: toolCall.toolName,
            arguments: toolCall.arguments ?? "{}",
          });
        }
        continue;
      }
    }

    if (message.role === "tool") {
      items.push({
        type: "function_call_output",
        call_id: message.toolCallId ?? "",
        output: message.content,
      });
      continue;
    }

    if (message.attachments?.length) {
      items.push({
        role: message.role,
        content: [
          ...message.attachments.flatMap(attachmentToResponsesContentParts),
          ...(message.content ? [{ type: "input_text", text: message.content } satisfies ResponsesContentPart] : []),
        ],
      });
      continue;
    }

    items.push({
      role: message.role,
      content: message.content,
    });
  }

  return items;
}

export interface OpenAIResponsesFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters: unknown;
  strict?: boolean;
}

/**
 * Converts provider tool schemas into Responses API internally-tagged function tool format.
 */
export function toOpenAIResponsesTools(tools?: ProviderToolSchema[]): OpenAIResponsesFunctionTool[] | undefined {
  if (!tools?.length) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    strict: false,
  }));
}

export interface StreamedResponsesToolCall {
  id?: string;
  call_id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface StreamedResponsesResult {
  content: string;
  toolCalls: StreamedResponsesToolCall[];
}

interface ToolCallAccumulator {
  callId?: string;
  name?: string;
  argumentsBuffer: string;
}

interface SSEEventChunk {
  type?: string;
  delta?: string;
  output_index?: number;
  content_index?: number;
  call_id?: string;
  name?: string;
  arguments?: string;
  item?: {
    id?: string;
    type?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  };
  response?: {
    status?: string;
    output?: Array<{
      id?: string;
      type?: string;
      call_id?: string;
      name?: string;
      arguments?: string;
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
  };
  error?: {
    message?: string;
  };
}

export async function streamOpenAIResponse(params: {
  fetcher: typeof fetch;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal?: AbortSignal;
  errorPrefix: string;
  onDelta: (delta: string) => void;
}): Promise<StreamedResponsesResult> {
  // Destructure fetcher into a local variable to preserve bare function invocation without detached this.
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

      let chunk: SSEEventChunk;
      try {
        chunk = JSON.parse(payload) as SSEEventChunk;
      } catch {
        continue;
      }

      if (chunk.type === "error" || chunk.error) {
        throw new Error(`${params.errorPrefix}: ${chunk.error?.message ?? JSON.stringify(chunk)}`);
      }

      // Stream text deltas
      if (chunk.type === "response.output_text.delta" && chunk.delta) {
        content += chunk.delta;
        params.onDelta(chunk.delta);
      }

      // Tool call started
      if (chunk.type === "response.output_item.added") {
        const outputIndex = chunk.output_index ?? 0;
        if (chunk.item?.type === "function_call") {
          const existing = toolCallsByIndex.get(outputIndex) ?? { argumentsBuffer: "" };
          if (chunk.item.call_id) {
            existing.callId = chunk.item.call_id;
          } else if (chunk.item.id) {
            existing.callId = chunk.item.id;
          }
          if (chunk.item.name) {
            existing.name = chunk.item.name;
          }
          if (chunk.item.arguments) {
            existing.argumentsBuffer = chunk.item.arguments;
          }
          toolCallsByIndex.set(outputIndex, existing);
        }
      }

      // Tool call arguments delta
      if (chunk.type === "response.function_call_arguments.delta") {
        const outputIndex = chunk.output_index ?? 0;
        const existing = toolCallsByIndex.get(outputIndex) ?? { argumentsBuffer: "" };
        if (chunk.delta) {
          existing.argumentsBuffer += chunk.delta;
        }
        toolCallsByIndex.set(outputIndex, existing);
      }

      // Tool call arguments done
      if (chunk.type === "response.function_call_arguments.done") {
        const outputIndex = chunk.output_index ?? 0;
        const existing = toolCallsByIndex.get(outputIndex) ?? { argumentsBuffer: "" };
        if (chunk.call_id) {
          existing.callId = chunk.call_id;
        }
        if (chunk.name) {
          existing.name = chunk.name;
        }
        if (chunk.arguments) {
          existing.argumentsBuffer = chunk.arguments;
        }
        toolCallsByIndex.set(outputIndex, existing);
      }

      // Tool call item done
      if (chunk.type === "response.output_item.done") {
        const outputIndex = chunk.output_index ?? 0;
        if (chunk.item?.type === "function_call") {
          const existing = toolCallsByIndex.get(outputIndex) ?? { argumentsBuffer: "" };
          if (chunk.item.call_id) {
            existing.callId = chunk.item.call_id;
          } else if (chunk.item.id) {
            existing.callId = chunk.item.id;
          }
          if (chunk.item.name) {
            existing.name = chunk.item.name;
          }
          if (chunk.item.arguments) {
            existing.argumentsBuffer = chunk.item.arguments;
          }
          toolCallsByIndex.set(outputIndex, existing);
        }
      }

      // Completed response verification
      if (chunk.type === "response.completed" && chunk.response?.output) {
        for (let idx = 0; idx < chunk.response.output.length; idx += 1) {
          const item = chunk.response.output[idx];
          if (item.type === "function_call") {
            const existing = toolCallsByIndex.get(idx) ?? { argumentsBuffer: "" };
            if (item.call_id) {
              existing.callId = item.call_id;
            } else if (item.id) {
              existing.callId = item.id;
            }
            if (item.name) {
              existing.name = item.name;
            }
            if (item.arguments) {
              existing.argumentsBuffer = item.arguments;
            }
            toolCallsByIndex.set(idx, existing);
          } else if (item.type === "message" && !content && item.content?.length) {
            // Fallback for non-streamed text or missing deltas
            const aggregated = item.content
              .filter((part) => part.type === "output_text" && part.text)
              .map((part) => part.text)
              .join("");
            if (aggregated) {
              content = aggregated;
              params.onDelta(aggregated);
            }
          }
        }
      }
    }
  }

  const toolCalls = Array.from(toolCallsByIndex.entries())
    .sort(([a], [b]) => a - b)
    .map(([, accumulated]) => ({
      id: accumulated.callId,
      call_id: accumulated.callId,
      function: {
        name: accumulated.name,
        arguments: accumulated.argumentsBuffer,
      },
    }));

  return { content, toolCalls };
}
