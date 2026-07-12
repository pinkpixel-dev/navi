import { describe, expect, test, vi } from "vitest";
import { createLmStudioProvider } from "./lmStudioProvider";

function sseResponse(chunks: unknown[], status = 200): Response {
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

describe("lm studio provider", () => {
  test("posts chat messages to the local LM Studio endpoint", async () => {
    const fetcher = vi.fn(async () => sseResponse([{ choices: [{ delta: { content: "Hello from LM Studio." } }] }]));
    const provider = createLmStudioProvider({ model: "qwen2.5-7b-instruct", fetcher });

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
      "http://localhost:1234/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(response.message.content).toBe("Hello from LM Studio.");
    expect(provider.model.location).toBe("local");
  });

  test("allows overriding the base URL", async () => {
    const fetcher = vi.fn(async () => sseResponse([{ choices: [{ delta: {} }] }]));
    const provider = createLmStudioProvider({
      model: "qwen2.5-7b-instruct",
      baseUrl: "http://192.168.1.10:1234/v1/",
      fetcher,
    });

    await provider.complete({ messages: [] });

    expect(fetcher).toHaveBeenCalledWith("http://192.168.1.10:1234/v1/chat/completions", expect.anything());
  });

  test("returns actionable errors for failed requests", async () => {
    const fetcher = vi.fn(async () => new Response("server not running", { status: 503 }));
    const provider = createLmStudioProvider({ model: "qwen2.5-7b-instruct", fetcher });

    await expect(provider.complete({ messages: [] })).rejects.toThrow("LM Studio provider request failed with 503");
  });

  test("fetches loaded LM Studio models", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "qwen2.5-7b-instruct" }, { id: "llama-3.2-3b" }] }), { status: 200 }),
    );
    const provider = createLmStudioProvider({ model: "qwen2.5-7b-instruct", fetcher });

    const models = await provider.listModels?.();

    expect(fetcher).toHaveBeenCalledWith("http://localhost:1234/v1/models", expect.objectContaining({ method: "GET" }));
    expect(models?.map((model) => model.id)).toEqual(["qwen2.5-7b-instruct", "llama-3.2-3b"]);
    expect(models?.[0].location).toBe("local");
  });
});
