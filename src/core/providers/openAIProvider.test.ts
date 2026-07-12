import { describe, expect, test, vi } from "vitest";
import { createOpenAIProvider } from "./openAIProvider";

function sseResponse(chunks: unknown[], status = 200): Response {
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

describe("openAI provider", () => {
  test("posts normalized chat messages to the OpenAI chat completions endpoint", async () => {
    const fetcher = vi.fn(async () => sseResponse([{ choices: [{ delta: { content: "Hello from OpenAI." } }] }]));
    const provider = createOpenAIProvider({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetcher,
    });

    const response = await provider.complete({
      messages: [
        {
          id: "message-1",
          role: "user",
          content: "Hello",
          createdAt: "2026-07-11T00:00:00.000Z",
        },
      ],
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
        }),
      }),
    );
    expect(response.message.content).toBe("Hello from OpenAI.");
    expect(response.toolCalls).toEqual([]);
  });

  test("streams incremental content deltas as they arrive", async () => {
    const fetcher = vi.fn(async () =>
      sseResponse([
        { choices: [{ delta: { content: "Hel" } }] },
        { choices: [{ delta: { content: "lo " } }] },
        { choices: [{ delta: { content: "there." } }] },
      ]),
    );
    const provider = createOpenAIProvider({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetcher,
    });

    const deltas: string[] = [];
    const response = await provider.complete({
      messages: [],
      onDelta: (delta) => deltas.push(delta),
    });

    expect(deltas).toEqual(["Hel", "lo ", "there."]);
    expect(response.message.content).toBe("Hello there.");
  });

  test("normalizes tool calls from OpenAI chat responses", async () => {
    const fetcher = vi.fn(async () =>
      sseResponse([
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, id: "call-1", function: { name: "read_plan", arguments: "" } }],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: "{\"path\":\"PLAN.md\"}" } }],
              },
            },
          ],
        },
      ]),
    );
    const provider = createOpenAIProvider({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetcher,
    });

    const response = await provider.complete({ messages: [] });

    expect(response.message.toolCalls?.[0]).toMatchObject({
      id: "call-1",
      toolName: "read_plan",
      status: "queued",
      risk: "read",
    });
    expect(response.toolCalls[0].summary).toContain("read_plan");
  });

  test("includes the tools schema in the request body when tools are provided", async () => {
    const fetcher = vi.fn(async () => sseResponse([{ choices: [{ delta: { content: "ok" } }] }]));
    const provider = createOpenAIProvider({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetcher,
    });

    await provider.complete({
      messages: [],
      tools: [{ type: "function", function: { name: "echo", description: "Echoes input", parameters: {} } }],
    });

    const [, requestInit] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(body.tools).toEqual([{ type: "function", function: { name: "echo", description: "Echoes input", parameters: {} } }]);
  });

  test("serializes an assistant tool-call message and its tool result with matching tool_call_id", async () => {
    const fetcher = vi.fn(async () => sseResponse([{ choices: [{ delta: { content: "ok" } }] }]));
    const provider = createOpenAIProvider({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetcher,
    });

    await provider.complete({
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "",
          createdAt: "2026-07-11T00:00:00.000Z",
          toolCalls: [
            {
              id: "call-1",
              serverName: "Canvas",
              toolName: "create_artifact",
              status: "completed",
              risk: "write",
              summary: "Create an artifact.",
              arguments: '{"title":"Notes"}',
            },
          ],
        },
        {
          id: "tool-result-1",
          role: "tool",
          content: "Artifact created.",
          createdAt: "2026-07-11T00:00:00.000Z",
          toolCallId: "call-1",
        },
      ],
    });

    const [, requestInit] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(body.messages).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call-1", type: "function", function: { name: "create_artifact", arguments: '{"title":"Notes"}' } }],
      },
      { role: "tool", tool_call_id: "call-1", content: "Artifact created." },
    ]);
  });

  test("returns actionable errors for failed OpenAI requests", async () => {
    const fetcher = vi.fn(async () => new Response("invalid api key", { status: 401 }));
    const provider = createOpenAIProvider({
      apiKey: "bad-key",
      model: "gpt-4o-mini",
      fetcher,
    });

    await expect(provider.complete({ messages: [] })).rejects.toThrow(
      "OpenAI provider request failed with 401",
    );
  });

  test("fetches OpenAI models", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: "gpt-4o-mini" },
            { id: "gpt-4o" },
            { id: "text-embedding-3-small" },
            { id: "whisper-1" },
            { id: "tts-1" },
            { id: "omni-moderation-latest" },
            { id: "gpt-4o-search-preview" },
            { id: "gpt-4o-transcribe" },
            { id: "gpt-image-1" },
            { id: "gpt-4o-audio-preview" },
            { id: "gpt-4o-realtime-preview" },
            { id: "sora-2" },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = createOpenAIProvider({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetcher,
    });

    expect(provider.listModels).toBeDefined();
    const models = await provider.listModels?.();

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      }),
    );
    expect(models?.map((model) => model.id)).toEqual(["gpt-4o-mini", "gpt-4o"]);
  });

  test("allows overriding the base URL", async () => {
    const fetcher = vi.fn(async () => sseResponse([{ choices: [{ delta: {} }] }]));
    const provider = createOpenAIProvider({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      baseUrl: "https://proxy.example.com/v1/",
      fetcher,
    });

    await provider.complete({ messages: [] });

    expect(fetcher).toHaveBeenCalledWith("https://proxy.example.com/v1/chat/completions", expect.anything());
  });
});
