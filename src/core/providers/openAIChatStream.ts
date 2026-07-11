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
