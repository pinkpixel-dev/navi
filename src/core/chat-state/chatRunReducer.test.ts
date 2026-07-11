import { describe, expect, test } from "vitest";
import type { ChatMessage, ToolCallEvent } from "../conversation/types";
import type { RunEvent } from "../agent-loop/types";
import { applyRunEvent, createInitialChatRunState } from "./chatRunReducer";

type EventWithoutGeneratedFields = RunEvent extends infer Event
  ? Event extends RunEvent
    ? Omit<Event, "id" | "timestamp">
    : never
  : never;

const baseToolCall: ToolCallEvent = {
  id: "tool-1",
  serverName: "Canvas",
  toolName: "create_artifact",
  status: "awaiting-approval",
  risk: "write",
  summary: "Create a canvas artifact.",
};

const assistantMessage: ChatMessage = {
  id: "assistant-1",
  role: "assistant",
  createdAt: "2026-07-11T00:00:00.000Z",
  content: "Final answer.",
};

function event(overrides: EventWithoutGeneratedFields): RunEvent {
  return {
    id: crypto.randomUUID(),
    timestamp: "2026-07-11T00:00:00.000Z",
    ...overrides,
  } as RunEvent;
}

describe("chat run reducer", () => {
  test("builds a pending assistant message from text deltas before completion", () => {
    const state = [
      event({ type: "run_started" }),
      event({ type: "assistant_text_delta", delta: "Hello" }),
      event({ type: "assistant_text_delta", delta: " there" }),
    ].reduce(applyRunEvent, createInitialChatRunState());

    expect(state.status).toBe("running");
    expect(state.pendingAssistantMessage?.content).toBe("Hello there");
    expect(state.events).toHaveLength(3);
  });

  test("tracks tool state as events arrive", () => {
    const state = [
      event({ type: "run_started" }),
      event({ type: "tool_call_requested", toolCall: baseToolCall }),
      event({ type: "tool_execution_started", toolCall: { ...baseToolCall, status: "running" } }),
      event({
        type: "tool_result_returned",
        toolCall: { ...baseToolCall, status: "completed" },
        result: "Created artifact.",
      }),
    ].reduce(applyRunEvent, createInitialChatRunState());

    expect(state.status).toBe("running");
    expect(state.toolCalls[0]).toMatchObject({
      id: "tool-1",
      status: "completed",
      result: "Created artifact.",
    });
  });

  test("promotes the completed assistant message and terminal status", () => {
    const state = [
      event({ type: "run_started" }),
      event({ type: "assistant_text_delta", delta: "Draft answer." }),
      event({ type: "assistant_message_completed", message: assistantMessage }),
      event({ type: "run_completed" }),
    ].reduce(applyRunEvent, createInitialChatRunState());

    expect(state.status).toBe("completed");
    expect(state.completedAssistantMessage).toEqual(assistantMessage);
    expect(state.pendingAssistantMessage).toBeNull();
  });

  test("stores cancelled status and cancellation reason", () => {
    const state = [
      event({ type: "run_started" }),
      event({
        type: "run_cancelled",
        reason: "user_cancelled",
        message: "The run was cancelled.",
      }),
    ].reduce(applyRunEvent, createInitialChatRunState());

    expect(state.status).toBe("cancelled");
    expect(state.failure).toBe("The run was cancelled.");
    expect(state.pendingAssistantMessage).toBeNull();
  });
});
