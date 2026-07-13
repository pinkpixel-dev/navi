import { describe, expect, test, vi } from "vitest";
import type { Conversation } from "../conversation/types";
import type { ProviderCompleteInput, ProviderResponse, ProviderToolSchema } from "../providers/types";
import { toOpenAIWireMessages } from "../providers/openAIChatStream";
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

  test("emits one delta per streamed chunk without a duplicated final delta", async () => {
    const result = await runAgentLoop({
      conversation: testConversation,
      input: "hello",
      providerComplete: async (input: ProviderCompleteInput) => {
        input.onDelta?.("Hello");
        input.onDelta?.(" back.");
        return createTextResponse("Hello back.");
      },
    });

    expect(result.status).toBe("completed");
    expect(result.events.filter((event) => event.type === "assistant_text_delta")).toHaveLength(2);
    expect(result.events.map((event) => event.type)).toEqual([
      "run_started",
      "model_request_started",
      "assistant_text_delta",
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

  test("adds saved user instructions and profile details to provider system context", async () => {
    let capturedInput: ProviderCompleteInput | undefined;
    const complete = vi.fn(async (input: ProviderCompleteInput) => {
      capturedInput = input;
      return createTextResponse("Personalized answer.");
    });

    await runAgentLoop({
      conversation: testConversation,
      input: "What should I work on?",
      userInstructions: "Use concise, practical guidance.",
      userProfile: {
        name: "Jessica",
        bio: "A developer building polished local AI tools.",
      },
      providerComplete: complete,
    });

    const systemMessage = capturedInput?.messages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("Answer the user's latest message directly.");
    expect(systemMessage?.content).toContain("User name: Jessica");
    expect(systemMessage?.content).toContain("User bio: A developer building polished local AI tools.");
    expect(systemMessage?.content).toContain("Additional user instructions: Use concise, practical guidance.");
  });

  test("adds project instructions to provider system context", async () => {
    let capturedInput: ProviderCompleteInput | undefined;

    await runAgentLoop({
      conversation: { ...testConversation, projectName: "Pink Pixel" },
      input: "Draft the next reply.",
      projectInstructions: "Keep this project focused on Pink Pixel launch work.",
      providerComplete: async (input: ProviderCompleteInput) => {
        capturedInput = input;
        return createTextResponse("Drafted.");
      },
    });

    const systemMessage = capturedInput?.messages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain(
      "Project instructions for Pink Pixel: Keep this project focused on Pink Pixel launch work.",
    );
  });

  test("ignores blank personalization fields when creating provider system context", async () => {
    let capturedInput: ProviderCompleteInput | undefined;

    await runAgentLoop({
      conversation: testConversation,
      input: "hello",
      userInstructions: "   ",
      userProfile: {
        name: "",
        bio: "   ",
      },
      providerComplete: async (input: ProviderCompleteInput) => {
        capturedInput = input;
        return createTextResponse("Hello.");
      },
    });

    const systemMessage = capturedInput?.messages.find((message) => message.role === "system");
    expect(systemMessage?.content).not.toContain("User name:");
    expect(systemMessage?.content).not.toContain("User bio:");
    expect(systemMessage?.content).not.toContain("Additional user instructions:");
  });

  test("passes attachments through to provider completion", async () => {
    let capturedInput: ProviderCompleteInput | undefined;
    const complete = vi.fn(async (input: ProviderCompleteInput) => {
      capturedInput = input;
      return createTextResponse("I can see it.");
    });

    await runAgentLoop({
      conversation: testConversation,
      input: "What is attached?",
      attachments: [{ id: "att-1", kind: "text", name: "notes.md", mimeType: "text/markdown", data: "# Notes" }],
      providerComplete: complete,
    });

    expect(capturedInput?.messages.at(-1)).toMatchObject({
      role: "user",
      content: "What is attached?",
      attachments: [{ name: "notes.md", data: "# Notes" }],
    });
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

describe("runAgentLoop with real tool execution", () => {
  test("executes an approved tool call and continues the loop for a final answer", async () => {
    let step = 0;
    const executeTool = vi.fn(async () => ({ content: "Artifact created.", isError: false }));
    const requestApproval = vi.fn(async () => "allow-once" as const);

    const result = await runAgentLoop({
      conversation: testConversation,
      input: "create an artifact",
      executeTool,
      requestApproval,
      providerComplete: async () => {
        step += 1;
        return step === 1 ? createToolCallResponse() : createTextResponse("Done, artifact created.");
      },
    });

    expect(result.status).toBe("completed");
    expect(result.message.content).toBe("Done, artifact created.");
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(result.message.toolCalls?.[0]?.status).toBe("completed");
    expect(result.events.map((event) => event.type)).toEqual([
      "run_started",
      "model_request_started",
      "tool_call_requested",
      "tool_call_awaiting_approval",
      "tool_execution_started",
      "tool_result_returned",
      "model_request_started",
      "assistant_text_delta",
      "assistant_message_completed",
      "run_completed",
    ]);
  });

  test("feeds the tool result back to the model as a tool message with matching toolCallId", async () => {
    let callCount = 0;
    const capturedInputs: ProviderCompleteInput[] = [];
    const toolCallId = crypto.randomUUID();

    const result = await runAgentLoop({
      conversation: testConversation,
      input: "create an artifact",
      executeTool: async () => ({ content: "Artifact created.", isError: false }),
      requestApproval: async () => "allow-once",
      providerComplete: async (providerInput) => {
        capturedInputs.push(providerInput);
        callCount += 1;
        if (callCount === 1) {
          const toolCalls: ProviderResponse["toolCalls"] = [
            {
              id: toolCallId,
              serverName: "Canvas",
              toolName: "create_artifact",
              status: "awaiting-approval",
              risk: "write",
              summary: "Create a new canvas artifact.",
            },
          ];
          return {
            message: {
              id: crypto.randomUUID(),
              role: "assistant",
              createdAt: "2026-07-11T00:00:00.000Z",
              content: "",
              toolCalls,
            },
            toolCalls,
          };
        }
        return createTextResponse("Done.");
      },
    });

    expect(result.status).toBe("completed");
    expect(capturedInputs[1]?.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "tool", toolCallId, content: "Artifact created." })]),
    );
  });

  test("executes the tool when the approval decision is allow-conversation", async () => {
    let step = 0;

    const result = await runAgentLoop({
      conversation: testConversation,
      input: "create an artifact",
      executeTool: async () => ({ content: "Artifact created.", isError: false }),
      requestApproval: async () => "allow-conversation",
      providerComplete: async () => {
        step += 1;
        return step === 1 ? createToolCallResponse() : createTextResponse("Done.");
      },
    });

    expect(result.status).toBe("completed");
    expect(result.events.map((event) => event.type)).toContain("tool_result_returned");
  });

  test("denies via requestApproval by feeding a denial back to the model and continuing", async () => {
    let step = 0;
    const executeTool = vi.fn(async () => ({ content: "should not run", isError: false }));

    const result = await runAgentLoop({
      conversation: testConversation,
      input: "create an artifact",
      executeTool,
      requestApproval: async () => "deny",
      providerComplete: async () => {
        step += 1;
        return step === 1 ? createToolCallResponse() : createTextResponse("Understood, I will not create it.");
      },
    });

    expect(result.status).toBe("completed");
    expect(result.message.content).toBe("Understood, I will not create it.");
    expect(executeTool).not.toHaveBeenCalled();
    expect(result.message.toolCalls?.[0]?.status).toBe("failed");
    expect(result.events.map((event) => event.type)).toEqual([
      "run_started",
      "model_request_started",
      "tool_call_requested",
      "tool_call_awaiting_approval",
      "tool_call_denied",
      "model_request_started",
      "assistant_text_delta",
      "assistant_message_completed",
      "run_completed",
    ]);
  });

  test("executes read-risk tools immediately without prompting for approval", async () => {
    let step = 0;
    const requestApproval = vi.fn(async () => "allow-once" as const);
    const executeTool = vi.fn(async () => ({ content: "Plan contents.", isError: false }));

    const result = await runAgentLoop({
      conversation: testConversation,
      input: "read the plan",
      executeTool,
      requestApproval,
      providerComplete: async () => {
        step += 1;
        if (step === 1) {
          const toolCalls: ProviderResponse["toolCalls"] = [
            {
              id: crypto.randomUUID(),
              serverName: "Local project",
              toolName: "read_plan",
              status: "queued",
              risk: "read",
              summary: "Reads local product planning notes.",
            },
          ];
          return {
            message: {
              id: crypto.randomUUID(),
              role: "assistant",
              createdAt: "2026-07-11T00:00:00.000Z",
              content: "",
              toolCalls,
            },
            toolCalls,
          };
        }
        return createTextResponse("Here is the plan.");
      },
    });

    expect(result.status).toBe("completed");
    expect(requestApproval).not.toHaveBeenCalled();
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  test("fails when tool calls accumulated across steps exceed the configured limit", async () => {
    let step = 0;

    const result = await runAgentLoop({
      conversation: testConversation,
      input: "create two artifacts",
      limits: { maxModelSteps: 8, maxToolCalls: 1 },
      executeTool: async () => ({ content: "done", isError: false }),
      requestApproval: async () => "allow-once",
      providerComplete: async () => {
        step += 1;
        return step <= 2 ? createToolCallResponse() : createTextResponse("Done.");
      },
    });

    expect(result.status).toBe("failed");
    expect(result.events.at(-1)).toMatchObject({
      type: "run_failed",
      reason: "tool_call_limit_reached",
    });
  });

  test("fails when the model keeps calling tools past the model step limit", async () => {
    const result = await runAgentLoop({
      conversation: testConversation,
      input: "loop forever",
      limits: { maxModelSteps: 2, maxToolCalls: 16 },
      executeTool: async () => ({ content: "done", isError: false }),
      requestApproval: async () => "allow-once",
      providerComplete: async () => createToolCallResponse(),
    });

    expect(result.status).toBe("failed");
    expect(result.events.at(-1)).toMatchObject({
      type: "run_failed",
      reason: "model_step_limit_reached",
    });
  });

  test("exposes a transcript so a completed tool call's assistant/tool messages can be persisted for the next turn", async () => {
    let step = 0;
    const toolCallId = crypto.randomUUID();

    const result = await runAgentLoop({
      conversation: testConversation,
      input: "create an artifact",
      executeTool: async () => ({ content: "Artifact created.", isError: false }),
      requestApproval: async () => "allow-once",
      providerComplete: async () => {
        step += 1;
        if (step === 1) {
          const toolCalls: ProviderResponse["toolCalls"] = [
            {
              id: toolCallId,
              serverName: "Canvas",
              toolName: "create_artifact",
              status: "awaiting-approval",
              risk: "write",
              summary: "Create a new canvas artifact.",
            },
          ];
          return {
            message: {
              id: crypto.randomUUID(),
              role: "assistant",
              createdAt: "2026-07-11T00:00:00.000Z",
              content: "",
              toolCalls,
            },
            toolCalls,
          };
        }
        return createTextResponse("Done.");
      },
    });

    expect(result.status).toBe("completed");
    expect(result.transcript).toEqual([
      expect.objectContaining({ role: "assistant", toolCalls: expect.arrayContaining([expect.objectContaining({ id: toolCallId })]) }),
      expect.objectContaining({ role: "tool", toolCallId, content: "Artifact created." }),
    ]);

    // Replaying transcript + final message as the seed for a follow-up turn must never
    // produce an orphaned tool_calls entry on the wire, whether or not a persisted message
    // still carries `toolCalls` for its own UI tool-card display.
    const nextTurnSeed = [...testConversation.messages, ...result.transcript, result.message];
    const wireMessages = toOpenAIWireMessages(nextTurnSeed);
    for (const wireMessage of wireMessages) {
      if ("tool_calls" in wireMessage) {
        const answeredIds = new Set(
          wireMessages
            .filter((candidate): candidate is { role: string; tool_call_id: string } => candidate.role === "tool")
            .map((candidate) => candidate.tool_call_id),
        );
        const toolCalls = wireMessage.tool_calls as Array<{ id: string }>;
        for (const toolCall of toolCalls) {
          expect(answeredIds.has(toolCall.id)).toBe(true);
        }
      }
    }
  });

  test("passes the tools schema through to the provider on every request", async () => {
    const tools: ProviderToolSchema[] = [{ type: "function", function: { name: "echo", parameters: {} } }];
    const capturedInputs: ProviderCompleteInput[] = [];

    await runAgentLoop({
      conversation: testConversation,
      input: "hello",
      tools,
      providerComplete: async (providerInput) => {
        capturedInputs.push(providerInput);
        return createTextResponse("hi");
      },
    });

    expect(capturedInputs[0]?.tools).toBe(tools);
  });
});
