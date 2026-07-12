import { describe, expect, test, vi } from "vitest";
import { createGeminiProvider, toGeminiInteractionInput, toGeminiTools } from "./geminiProvider";

function sseResponse(chunks: unknown[], status = 200): Response {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("");
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

describe("gemini provider", () => {
  test("posts turns to the Interactions API", async () => {
    const fetcher = vi.fn(async () => sseResponse([{ event_type: "step.delta", delta: { type: "text", text: "Hello from Gemini." } }]));
    const provider = createGeminiProvider({
      apiKey: "test-key",
      model: "gemini-2.5-flash",
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
      "https://generativelanguage.googleapis.com/v1beta/interactions?alt=sse",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-goog-api-key": "test-key" }),
      }),
    );
    const [, requestInit] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(body).toMatchObject({
      model: "gemini-2.5-flash",
      store: false,
      stream: true,
      input: [{ type: "user_input", content: [{ type: "text", text: "Hello" }] }],
    });
    expect(response.message.content).toBe("Hello from Gemini.");
  });

  test("streams incremental text deltas", async () => {
    const fetcher = vi.fn(async () =>
      sseResponse([
        { event_type: "step.start", index: 0, step: { type: "model_output" } },
        { event_type: "step.delta", index: 0, delta: { type: "text", text: "Hel" } },
        { event_type: "step.delta", index: 0, delta: { type: "text", text: "lo." } },
      ]),
    );
    const provider = createGeminiProvider({ apiKey: "test-key", model: "gemini-2.5-flash", fetcher });

    const deltas: string[] = [];
    const response = await provider.complete({ messages: [], onDelta: (delta) => deltas.push(delta) });

    expect(deltas).toEqual(["Hel", "lo."]);
    expect(response.message.content).toBe("Hello.");
  });

  test("normalizes streamed functionCall parts into tool calls", async () => {
    const fetcher = vi.fn(async () =>
      sseResponse([
        { event_type: "step.start", index: 0, step: { type: "function_call", id: "call-1", name: "read_plan" } },
        { event_type: "step.delta", index: 0, delta: { type: "arguments", partial_arguments: "{\"path\":\"PLAN.md\"}" } },
      ]),
    );
    const provider = createGeminiProvider({ apiKey: "test-key", model: "gemini-2.5-flash", fetcher });

    const response = await provider.complete({ messages: [] });

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0]).toMatchObject({
      id: "call-1",
      toolName: "read_plan",
      status: "queued",
      risk: "read",
      arguments: '{"path":"PLAN.md"}',
    });
  });

  test("serializes system, tool calls, and tool results into Gemini Interactions input", () => {
    const wire = toGeminiInteractionInput([
      { id: "s1", role: "system", content: "Be terse.", createdAt: "2026-07-11T00:00:00.000Z" },
      { id: "u1", role: "user", content: "Read the plan.", createdAt: "2026-07-11T00:00:00.000Z" },
      {
        id: "a1",
        role: "assistant",
        content: "",
        createdAt: "2026-07-11T00:00:00.000Z",
        toolCalls: [
          {
            id: "call-1",
            serverName: "Gemini",
            toolName: "read_plan",
            status: "completed",
            risk: "read",
            summary: "Read PLAN.md",
            arguments: '{"path":"PLAN.md"}',
          },
        ],
      },
      { id: "t1", role: "tool", content: "Plan contents.", createdAt: "2026-07-11T00:00:00.000Z", toolCallId: "call-1" },
    ]);

    expect(wire.systemInstruction).toBe("Be terse.");
    expect(wire.input).toEqual([
      { type: "user_input", content: [{ type: "text", text: "Read the plan." }] },
      { type: "function_call", id: "call-1", name: "read_plan", arguments: { path: "PLAN.md" } },
      { type: "function_result", call_id: "call-1", name: "read_plan", result: [{ type: "text", text: "Plan contents." }] },
    ]);
  });

  test("serializes image attachments as Interactions image blocks", () => {
    const wire = toGeminiInteractionInput([
      {
        id: "u1",
        role: "user",
        content: "What is this?",
        createdAt: "2026-07-11T00:00:00.000Z",
        attachments: [{ id: "att-1", kind: "image", name: "photo.png", mimeType: "image/png", data: "aGk=" }],
      },
    ]);

    expect(wire.input[0]).toEqual({
      type: "user_input",
      content: [
      { type: "image", mime_type: "image/png", data: "aGk=" },
      { type: "text", text: "What is this?" },
      ],
    });
  });

  test("strips unsupported JSON Schema keywords from tool parameters", () => {
    const tools = toGeminiTools([
      {
        type: "function",
        function: {
          name: "echo",
          description: "Echoes input",
          parameters: {
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            additionalProperties: false,
            properties: { value: { type: "string" } },
          },
        },
      },
    ]);

    expect(tools).toEqual([
      {
        type: "function",
        name: "echo",
        description: "Echoes input",
        parameters: { type: "object", properties: { value: { type: "string" } } },
      },
    ]);
  });

  test("returns actionable errors for failed requests", async () => {
    const fetcher = vi.fn(async () => new Response("invalid api key", { status: 400 }));
    const provider = createGeminiProvider({ apiKey: "bad-key", model: "gemini-2.5-flash", fetcher });

    await expect(provider.complete({ messages: [] })).rejects.toThrow("Gemini provider request failed with 400");
  });

  test("fetches Gemini models and strips the models/ prefix", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          models: [
            {
              name: "models/gemini-2.5-pro",
              displayName: "Gemini 2.5 Pro",
              inputTokenLimit: 1048576,
              supportedGenerationMethods: ["generateContent"],
            },
            {
              name: "models/embedding-001",
              displayName: "Embedding 001",
              supportedGenerationMethods: ["embedContent"],
            },
            {
              name: "models/gemini-image-flash",
              displayName: "Gemini Image Flash",
              supportedGenerationMethods: ["generateContent"],
            },
            {
              name: "models/gemini-omni-flash-preview",
              displayName: "Gemini Omni Flash Preview",
              supportedGenerationMethods: ["generateContent"],
            },
            {
              name: "models/veo-3-fast-generate-preview",
              displayName: "Veo 3 Fast Generate Preview",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = createGeminiProvider({ apiKey: "test-key", model: "gemini-2.5-flash", fetcher });

    const models = await provider.listModels?.();

    expect(models?.map((model) => model.id)).toEqual(["gemini-2.5-pro"]);
    expect(models?.[0].name).toBe("Gemini 2.5 Pro");
    expect(models?.[0].contextTokens).toBe(1048576);
  });

  test("does not advertise tool calling for a manually selected Gemini video model", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          models: [
            {
              name: "models/gemini-2.5-flash",
              displayName: "Gemini 2.5 Flash",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = createGeminiProvider({ apiKey: "test-key", model: "gemini-omni-flash-preview", fetcher });

    const models = await provider.listModels?.();

    expect(provider.model.capabilities).not.toContain("tools");
    expect(models?.map((model) => model.id)).toEqual(["gemini-2.5-flash"]);
  });
});
