import { describe, expect, test } from "vitest";
import type { Conversation } from "../conversation/types";
import type { ProviderCompleteInput, ProviderResponse } from "../providers/types";
import { runAgentLoop } from "./agentLoop";

const conversation: Conversation = {
  id: "rich-response-chat",
  title: "Rich response test",
  projectName: "Navi",
  provider: "Test provider",
  model: "test-model",
  processing: "external",
  isPinned: false,
  updatedAt: "2026-08-31T00:00:00.000Z",
  messages: [],
};

function createTextResponse(content: string): ProviderResponse {
  return {
    message: {
      id: crypto.randomUUID(),
      role: "assistant",
      createdAt: "2026-08-31T00:00:00.000Z",
      content,
    },
    toolCalls: [],
  };
}

describe("runAgentLoop rich responses", () => {
  test("keeps chunks buffered until a valid response completes", async () => {
    const richContent = "```navi-rich\n<section><h2>Hello</h2><p>Rich answer.</p></section>\n```";
    const result = await runAgentLoop({
      conversation,
      input: "hello",
      richResponsesEnabled: true,
      providerComplete: async (input: ProviderCompleteInput) => {
        input.onDelta?.("```navi-rich\n<section>");
        input.onDelta?.("<h2>Hello</h2><p>Rich answer.</p></section>\n```");
        return createTextResponse(richContent);
      },
    });

    expect(result.status).toBe("completed");
    expect(result.message.content).toBe(richContent);
    expect(result.events.map((event) => event.type)).toEqual([
      "run_started",
      "model_request_started",
      "assistant_message_completed",
      "run_completed",
    ]);
  });

  test("rejects a Markdown-only result", async () => {
    const result = await runAgentLoop({
      conversation,
      input: "hello",
      richResponsesEnabled: true,
      providerComplete: async (input: ProviderCompleteInput) => {
        input.onDelta?.("## Hello\n\n");
        input.onDelta?.("This is Markdown.");
        return createTextResponse("## Hello\n\nThis is Markdown.");
      },
    });

    expect(result.status).toBe("failed");
    expect(result.message.content).toContain("did not return a complete Rich Response");
    expect(result.events).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "assistant_text_delta" })]));
    expect(result.events.at(-1)).toMatchObject({
      type: "run_failed",
      reason: "invalid_response_format",
    });
  });
});
