import { describe, expect, test, vi } from "vitest";
import type { Conversation } from "../conversation/types";
import type { ProviderCompleteInput, ProviderResponse } from "../providers/types";
import type { RunEvent } from "./types";
import { runAgentLoop } from "./agentLoop";

const testConversation: Conversation = {
  id: "test-chat",
  title: "Test chat",
  projectName: "Navi",
  provider: "Test provider",
  model: "test-model",
  processing: "external",
  isPinned: false,
  updatedAt: "Just now",
  messages: [
    {
      id: "message-user",
      role: "user",
      createdAt: "2026-07-11T00:00:00.000Z",
      content: "Previous user message.",
    },
  ],
};

const seededDemoConversation: Conversation = {
  ...testConversation,
  messages: [
    {
      id: "message-welcome",
      role: "assistant",
      createdAt: "2026-07-11T00:00:00.000Z",
      content: "Welcome to Navi.",
    },
    ...testConversation.messages,
  ],
};

function createTextResponse(content: string): ProviderResponse {
  return {
    message: {
      id: crypto.randomUUID(),
      role: "assistant",
      createdAt: "2026-07-11T00:00:00.000Z",
      content,
    },
    toolCalls: [],
  };
}

function createToolCallResponse(): ProviderResponse {
  const toolCalls: ProviderResponse["toolCalls"] = [
    {
      id: crypto.randomUUID(),
      serverName: "Canvas",
      toolName: "create_artifact",
      status: "awaiting-approval",
      risk: "write",
      summary: "Create a new canvas artifact from the assistant response.",
    },
  ];

  return {
    message: {
      id: crypto.randomUUID(),
      role: "assistant",
      createdAt: "2026-07-11T00:00:00.000Z",
      content: "I can create that artifact after approval.",
      toolCalls,
    },
    toolCalls,
  };
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("runAgentLoop", () => {
  test("emits a normalized event timeline for a normal assistant response", async () => {
    const result = await runAgentLoop({
      conversation: testConversation,
      input: "hello",
      providerComplete: async () => createTextResponse("Hello back."),
    });

    expect(result.status).toBe("completed");
    expect(result.message.role).toBe("assistant");
    expect(result.events.map((event) => event.type)).toEqual([
      "run_started",
      "model_request_started",
      "assistant_text_delta",
      "assistant_message_completed",
      "run_completed",
    ]);
  });

  test("pauses and denies a write tool when approval policy rejects it", async () => {
    const result = await runAgentLoop({
      conversation: testConversation,
      input: "create an artifact",
      approvalPolicy: "deny-writes",
      providerComplete: async () => createToolCallResponse(),
    });

    expect(result.status).toBe("completed");
    expect(result.message.toolCalls?.[0]?.status).toBe("failed");
    expect(result.events.map((event) => event.type)).toEqual([
      "run_started",
      "model_request_started",
      "tool_call_requested",
      "tool_call_awaiting_approval",
      "tool_call_denied",
      "assistant_message_completed",
      "run_completed",
    ]);
    expect(result.message.content).toContain("denied");
  });

  test("fails when requested tool calls exceed the configured limit", async () => {
    const result = await runAgentLoop({
      conversation: testConversation,
      input: "plan with too many tools",
      limits: {
        maxModelSteps: 8,
        maxToolCalls: 0,
      },
      providerComplete: async () => createToolCallResponse(),
    });

    expect(result.status).toBe("failed");
    expect(result.events.at(-1)).toMatchObject({
      type: "run_failed",
      reason: "tool_call_limit_reached",
    });
  });

  test("emits events through a callback as the run advances", async () => {
    const emittedTypes: string[] = [];

    await runAgentLoop({
      conversation: testConversation,
      input: "hello",
      providerComplete: async () => createTextResponse("Hello back."),
      onEvent: (event: RunEvent) => emittedTypes.push(event.type),
    });

    expect(emittedTypes).toEqual([
      "run_started",
      "model_request_started",
      "assistant_text_delta",
      "assistant_message_completed",
      "run_completed",
    ]);
  });

  test("cancels a run when the abort signal fires before the provider responds", async () => {
    const controller = new AbortController();
    const emittedTypes: string[] = [];

    const resultPromise = runAgentLoop({
      conversation: testConversation,
      input: "hello",
      signal: controller.signal,
      providerComplete: async () => {
        await delay(50);
        return createTextResponse("Hello back.");
      },
      onEvent: (event: RunEvent) => emittedTypes.push(event.type),
    });

    controller.abort();
    const result = await resultPromise;

    expect(result.status).toBe("cancelled");
    expect(result.events.at(-1)).toMatchObject({
      type: "run_cancelled",
      reason: "user_cancelled",
    });
    expect(emittedTypes).toContain("run_cancelled");
  });

  test("fails with a timeout event when the provider takes too long", async () => {
    const result = await runAgentLoop({
      conversation: testConversation,
      input: "hello",
      timeoutMs: 1,
      providerComplete: async () => {
        await delay(50);
        return createTextResponse("Hello back.");
      },
    });

    expect(result.status).toBe("failed");
    expect(result.events.at(-1)).toMatchObject({
      type: "run_failed",
      reason: "timeout",
    });
  });

  test("retries transient provider failures before completing", async () => {
    let attempts = 0;

    const result = await runAgentLoop({
      conversation: testConversation,
      input: "transient failure then hello",
      retry: {
        maxAttempts: 2,
      },
      providerComplete: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("Transient provider failure.");
        }
        return createTextResponse("Hello back.");
      },
    });

    expect(result.status).toBe("completed");
    expect(result.events.map((event) => event.type)).toContain("run_retrying");
    expect(result.message.content).toBe("Hello back.");
  });

  test("uses an injected provider completion with user context and the new user input", async () => {
    let capturedInput: ProviderCompleteInput | undefined;
    const complete = vi.fn(async (input: ProviderCompleteInput) => {
      capturedInput = input;
      return createTextResponse("Provider answered.");
    });

    const result = await runAgentLoop({
      conversation: seededDemoConversation,
      input: "Use configured provider",
      providerComplete: complete,
    });

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "user", content: "Use configured provider" }),
        ]),
      }),
    );
    expect(capturedInput).toBeDefined();
    expect(capturedInput?.messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "message-welcome" })]),
    );
    expect(result.message.content).toBe("Provider answered.");
  });

  test("does not send internal provider failure messages back to injected providers", async () => {
    let capturedInput: ProviderCompleteInput | undefined;
    const complete = vi.fn(async (input: ProviderCompleteInput) => {
      capturedInput = input;
      return createTextResponse("Clean context.");
    });

    await runAgentLoop({
      conversation: {
        ...testConversation,
        messages: [
          ...testConversation.messages,
          {
            id: "failed-message",
            role: "assistant",
            createdAt: "2026-07-11T00:00:00.000Z",
            content: "The provider request failed.",
          },
        ],
      },
      input: "hello",
      providerComplete: complete,
    });

    expect(capturedInput).toBeDefined();
    expect(capturedInput?.messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ content: "The provider request failed." })]),
    );
  });
});
