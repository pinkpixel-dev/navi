import { describe, expect, test, vi } from "vitest";
import { createOllamaProvider } from "./ollamaProvider";

function sseResponse(chunks: unknown[], status = 200): Response {
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

describe("ollama provider", () => {
  test("posts normalized chat messages to the local Ollama endpoint by default", async () => {
    const fetcher = vi.fn(async () => sseResponse([{ choices: [{ delta: { content: "Hi there." } }] }]));
    const provider = createOllamaProvider({
      model: "granite4:latest",
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
      "http://localhost:11434/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          model: "granite4:latest",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
        }),
      }),
    );
    expect(response.message.content).toBe("Hi there.");
    expect(response.toolCalls).toEqual([]);
  });

  test("does not send an Authorization header when no api key is configured", async () => {
    const fetcher = vi.fn(async () => sseResponse([{ choices: [{ delta: { content: "ok" } }] }]));
    const provider = createOllamaProvider({ model: "granite4:latest", fetcher });

    await provider.complete({ messages: [] });

    expect(fetcher).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ headers: expect.not.objectContaining({ Authorization: expect.anything() }) }),
    );
  });

  test("streams incremental content deltas as they arrive", async () => {
    const fetcher = vi.fn(async () =>
      sseResponse([
        { choices: [{ delta: { content: "Hel" } }] },
        { choices: [{ delta: { content: "lo " } }] },
        { choices: [{ delta: { content: "there." } }] },
      ]),
    );
    const provider = createOllamaProvider({ model: "granite4:latest", fetcher });

    const deltas: string[] = [];
    const response = await provider.complete({
      messages: [],
      onDelta: (delta) => deltas.push(delta),
    });

    expect(deltas).toEqual(["Hel", "lo ", "there."]);
    expect(response.message.content).toBe("Hello there.");
  });

  test("normalizes tool calls from Ollama chat responses", async () => {
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
    const provider = createOllamaProvider({ model: "granite4:latest", fetcher });

    const response = await provider.complete({ messages: [] });

    expect(response.message.toolCalls?.[0]).toMatchObject({
      id: "call-1",
      toolName: "read_plan",
      status: "queued",
      risk: "read",
    });
    expect(response.toolCalls[0].summary).toContain("read_plan");
  });

  test("returns actionable errors for failed Ollama requests", async () => {
    const fetcher = vi.fn(async () => new Response("model not found", { status: 404 }));
    const provider = createOllamaProvider({ model: "missing-model", fetcher });

    await expect(provider.complete({ messages: [] })).rejects.toThrow("Ollama provider request failed with 404");
  });

  test("fetches Ollama models", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "granite4:latest" }, { id: "qwen3.5:latest" }] }), { status: 200 }),
    );
    const provider = createOllamaProvider({ model: "granite4:latest", fetcher });

    const models = await provider.listModels?.();

    expect(fetcher).toHaveBeenCalledWith("http://localhost:11434/v1/models", expect.objectContaining({ method: "GET" }));
    expect(models?.map((model) => model.id)).toEqual(["granite4:latest", "qwen3.5:latest"]);
  });

  test("allows overriding the base URL", async () => {
    const fetcher = vi.fn(async () => sseResponse([{ choices: [{ delta: {} }] }]));
    const provider = createOllamaProvider({
      model: "granite4:latest",
      baseUrl: "http://192.168.1.50:11434/v1/",
      fetcher,
    });

    await provider.complete({ messages: [] });

    expect(fetcher).toHaveBeenCalledWith("http://192.168.1.50:11434/v1/chat/completions", expect.anything());
  });
});
