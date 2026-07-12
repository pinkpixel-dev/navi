import { describe, expect, test, vi } from "vitest";
import { createOpenRouterProvider } from "./openRouterProvider";

function sseResponse(chunks: unknown[], status = 200): Response {
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

describe("openRouter provider", () => {
  test("posts chat messages to the OpenRouter chat completions endpoint", async () => {
    const fetcher = vi.fn(async () => sseResponse([{ choices: [{ delta: { content: "Hello from OpenRouter." } }] }]));
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      model: "anthropic/claude-sonnet-5",
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
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          "X-Title": "Navi",
        }),
      }),
    );
    expect(response.message.content).toBe("Hello from OpenRouter.");
  });

  test("normalizes tool calls with the OpenRouter server name", async () => {
    const fetcher = vi.fn(async () =>
      sseResponse([
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, id: "call-1", function: { name: "read_plan", arguments: "{}" } }],
              },
            },
          ],
        },
      ]),
    );
    const provider = createOpenRouterProvider({ apiKey: "test-key", model: "openai/gpt-4o", fetcher });

    const response = await provider.complete({ messages: [] });

    expect(response.toolCalls[0]).toMatchObject({
      id: "call-1",
      serverName: "OpenRouter",
      toolName: "read_plan",
      risk: "read",
    });
  });

  test("returns actionable errors for failed requests", async () => {
    const fetcher = vi.fn(async () => new Response("invalid api key", { status: 401 }));
    const provider = createOpenRouterProvider({ apiKey: "bad-key", model: "openai/gpt-4o", fetcher });

    await expect(provider.complete({ messages: [] })).rejects.toThrow("OpenRouter provider request failed with 401");
  });

  test("fetches OpenRouter models with names and context lengths", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5", context_length: 1000000 },
            { id: "openai/gpt-4o", name: "GPT-4o", context_length: 128000 },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = createOpenRouterProvider({ apiKey: "test-key", model: "openai/gpt-4o", fetcher });

    const models = await provider.listModels?.();

    expect(fetcher).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      expect.objectContaining({ method: "GET" }),
    );
    expect(models?.map((model) => model.id)).toEqual(["anthropic/claude-sonnet-5", "openai/gpt-4o"]);
    expect(models?.[0].name).toBe("Claude Sonnet 5");
    expect(models?.[0].contextTokens).toBe(1000000);
  });
});
