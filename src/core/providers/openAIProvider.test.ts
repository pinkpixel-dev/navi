import { describe, expect, test, vi } from "vitest";
import { createOpenAIProvider } from "./openAIProvider";

describe("openAI provider", () => {
  test("posts normalized chat messages to the OpenAI chat completions endpoint", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: "Hello from OpenAI.",
              },
            },
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
          stream: false,
        }),
      }),
    );
    expect(response.message.content).toBe("Hello from OpenAI.");
    expect(response.toolCalls).toEqual([]);
  });

  test("normalizes tool calls from OpenAI chat responses", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "read_plan",
                      arguments: "{\"path\":\"PLAN.md\"}",
                    },
                  },
                ],
              },
            },
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

    const response = await provider.complete({ messages: [] });

    expect(response.message.toolCalls?.[0]).toMatchObject({
      id: "call-1",
      toolName: "read_plan",
      status: "queued",
      risk: "read",
    });
    expect(response.toolCalls[0].summary).toContain("read_plan");
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
          data: [{ id: "gpt-4o-mini" }, { id: "gpt-4o" }],
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
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }));
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
