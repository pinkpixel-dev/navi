import { describe, expect, test, vi } from "vitest";
import { createOpenAICompatibleProvider } from "./openAICompatibleProvider";

describe("openAI compatible provider", () => {
  test("posts normalized chat messages to the chat completions endpoint", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: "Hello from a compatible endpoint.",
              },
            },
          ],
        }),
        { status: 200 },
      ),
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
          stream: false,
        }),
      }),
    );
    expect(response.message.content).toBe("Hello from a compatible endpoint.");
    expect(response.toolCalls).toEqual([]);
  });

  test("normalizes tool calls from compatible chat responses", async () => {
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
