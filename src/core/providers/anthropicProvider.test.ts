import { describe, expect, test, vi } from "vitest";
import { createAnthropicProvider, toAnthropicWireMessages } from "./anthropicProvider";

function sseResponse(events: Array<{ event: string; data: unknown }>, status = 200): Response {
  const body = events.map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

describe("anthropic provider", () => {
  test("posts messages to the Anthropic messages endpoint with required headers", async () => {
    const fetcher = vi.fn(async () =>
      sseResponse([
        {
          event: "content_block_delta",
          data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello from Claude." } },
        },
      ]),
    );
    const provider = createAnthropicProvider({
      apiKey: "test-key",
      model: "claude-opus-4-8",
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
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-api-key": "test-key",
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        }),
      }),
    );
    const [, requestInit] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(body.model).toBe("claude-opus-4-8");
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.messages).toEqual([{ role: "user", content: [{ type: "text", text: "Hello" }] }]);
    expect(response.message.content).toBe("Hello from Claude.");
    expect(response.toolCalls).toEqual([]);
  });

  test("streams incremental content deltas as they arrive", async () => {
    const fetcher = vi.fn(async () =>
      sseResponse([
        { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } } },
        { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo." } } },
      ]),
    );
    const provider = createAnthropicProvider({ apiKey: "test-key", model: "claude-opus-4-8", fetcher });

    const deltas: string[] = [];
    const response = await provider.complete({ messages: [], onDelta: (delta) => deltas.push(delta) });

    expect(deltas).toEqual(["Hel", "lo."]);
    expect(response.message.content).toBe("Hello.");
  });

  test("accumulates streamed tool_use blocks into normalized tool calls", async () => {
    const fetcher = vi.fn(async () =>
      sseResponse([
        {
          event: "content_block_start",
          data: {
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", id: "toolu_1", name: "read_plan" },
          },
        },
        {
          event: "content_block_delta",
          data: { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"path":' } },
        },
        {
          event: "content_block_delta",
          data: { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"PLAN.md"}' } },
        },
      ]),
    );
    const provider = createAnthropicProvider({ apiKey: "test-key", model: "claude-opus-4-8", fetcher });

    const response = await provider.complete({ messages: [] });

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0]).toMatchObject({
      id: "toolu_1",
      toolName: "read_plan",
      status: "queued",
      risk: "read",
      arguments: '{"path":"PLAN.md"}',
    });
  });

  test("converts OpenAI-style tool schemas to Anthropic tool definitions", async () => {
    const fetcher = vi.fn(async () =>
      sseResponse([
        { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } } },
      ]),
    );
    const provider = createAnthropicProvider({ apiKey: "test-key", model: "claude-opus-4-8", fetcher });

    await provider.complete({
      messages: [],
      tools: [{ type: "function", function: { name: "echo", description: "Echoes input", parameters: { type: "object" } } }],
    });

    const [, requestInit] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(body.tools).toEqual([{ name: "echo", description: "Echoes input", input_schema: { type: "object" } }]);
  });

  test("serializes system, tool_use, and tool_result messages into the Anthropic wire format", () => {
    const wire = toAnthropicWireMessages([
      { id: "s1", role: "system", content: "Be terse.", createdAt: "2026-07-11T00:00:00.000Z" },
      { id: "u1", role: "user", content: "Read the plan.", createdAt: "2026-07-11T00:00:00.000Z" },
      {
        id: "a1",
        role: "assistant",
        content: "",
        createdAt: "2026-07-11T00:00:00.000Z",
        toolCalls: [
          {
            id: "toolu_1",
            serverName: "Anthropic",
            toolName: "read_plan",
            status: "completed",
            risk: "read",
            summary: "Read PLAN.md",
            arguments: '{"path":"PLAN.md"}',
          },
        ],
      },
      { id: "t1", role: "tool", content: "Plan contents.", createdAt: "2026-07-11T00:00:00.000Z", toolCallId: "toolu_1" },
    ]);

    expect(wire.system).toBe("Be terse.");
    expect(wire.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Read the plan." }] },
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "read_plan", input: { path: "PLAN.md" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "Plan contents." }] },
    ]);
  });

  test("serializes image attachments as base64 image blocks", () => {
    const wire = toAnthropicWireMessages([
      {
        id: "u1",
        role: "user",
        content: "What is this?",
        createdAt: "2026-07-11T00:00:00.000Z",
        attachments: [{ id: "att-1", kind: "image", name: "photo.png", mimeType: "image/png", data: "aGk=" }],
      },
    ]);

    expect(wire.messages[0].content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "aGk=" } },
      { type: "text", text: "What is this?" },
    ]);
  });

  test("returns actionable errors for failed requests", async () => {
    const fetcher = vi.fn(async () => new Response("invalid api key", { status: 401 }));
    const provider = createAnthropicProvider({ apiKey: "bad-key", model: "claude-opus-4-8", fetcher });

    await expect(provider.complete({ messages: [] })).rejects.toThrow("Anthropic provider request failed with 401");
  });

  test("fetches Anthropic models", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: "claude-opus-4-8", display_name: "Claude Opus 4.8" },
            { id: "claude-sonnet-5", display_name: "Claude Sonnet 5" },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = createAnthropicProvider({ apiKey: "test-key", model: "claude-opus-4-8", fetcher });

    const models = await provider.listModels?.();

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ "x-api-key": "test-key" }),
      }),
    );
    expect(models?.map((model) => model.id)).toEqual(["claude-opus-4-8", "claude-sonnet-5"]);
    expect(models?.[0].name).toBe("Claude Opus 4.8");
  });
});
