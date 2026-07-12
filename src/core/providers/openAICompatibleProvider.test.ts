import { describe, expect, test, vi } from "vitest";
import { createOpenAICompatibleProvider } from "./openAICompatibleProvider";

function sseResponse(chunks: unknown[], status = 200): Response {
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

describe("openAI compatible provider", () => {
  test("posts normalized chat messages to the chat completions endpoint", async () => {
    const fetcher = vi.fn(async () =>
      sseResponse([{ choices: [{ delta: { content: "Hello from a compatible endpoint." } }] }]),
    );
    const provider = createOpenAICompatibleProvider({
      baseUrl: "http://localhost:8080/v1",
      apiKey: "test-key",
      model: "local-model",
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
      "http://localhost:8080/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          model: "local-model",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
        }),
      }),
    );
    expect(response.message.content).toBe("Hello from a compatible endpoint.");
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
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.com",
      model: "hosted-model",
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

  test("normalizes tool calls from compatible chat responses", async () => {
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
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.com",
      model: "hosted-model",
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

  test("returns actionable errors for failed compatible endpoints", async () => {
    const fetcher = vi.fn(async () => new Response("bad gateway", { status: 502 }));
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.com/v1",
      model: "hosted-model",
      fetcher,
    });

    await expect(provider.complete({ messages: [] })).rejects.toThrow(
      "OpenAI-compatible provider request failed with 502",
    );
  });

  test("includes the tools schema in the request body when tools are provided", async () => {
    const fetcher = vi.fn(async () => sseResponse([{ choices: [{ delta: { content: "ok" } }] }]));
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.com",
      model: "hosted-model",
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
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.com",
      model: "hosted-model",
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

  test("fetches compatible provider models", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [{ id: "llama-3.1" }, { id: "qwen-tool" }],
        }),
        { status: 200 },
      ),
    );
    const provider = createOpenAICompatibleProvider({
      baseUrl: "http://localhost:8080/v1",
      model: "llama-3.1",
      fetcher,
    });

    expect(provider.listModels).toBeDefined();
    const models = await provider.listModels?.();

    expect(fetcher).toHaveBeenCalledWith("http://localhost:8080/v1/models", expect.objectContaining({ method: "GET" }));
    expect(models?.map((model) => model.id)).toEqual(["llama-3.1", "qwen-tool"]);
  });
});
