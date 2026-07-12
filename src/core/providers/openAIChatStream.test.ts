import { describe, expect, test } from "vitest";
import type { ChatMessage } from "../conversation/types";
import { toOpenAIWireMessages } from "./openAIChatStream";

describe("toOpenAIWireMessages", () => {
  test("maps plain user and assistant messages by role and content", () => {
    const messages: ChatMessage[] = [
      { id: "1", role: "user", content: "Hello", createdAt: "2026-07-11T00:00:00.000Z" },
      { id: "2", role: "assistant", content: "Hi there.", createdAt: "2026-07-11T00:00:00.000Z" },
    ];

    expect(toOpenAIWireMessages(messages)).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there." },
    ]);
  });

  test("serializes an assistant tool-call message answered by matching tool messages", () => {
    const messages: ChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        content: "",
        createdAt: "2026-07-11T00:00:00.000Z",
        toolCalls: [
          {
            id: "call-1",
            serverName: "Canvas",
            toolName: "create_artifact",
            status: "completed",
            risk: "write",
            summary: "Create an artifact.",
            arguments: '{"title":"Notes"}',
          },
        ],
      },
      { id: "tool-1", role: "tool", content: "Artifact created.", createdAt: "2026-07-11T00:00:00.000Z", toolCallId: "call-1" },
    ];

    expect(toOpenAIWireMessages(messages)).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call-1", type: "function", function: { name: "create_artifact", arguments: '{"title":"Notes"}' } }],
      },
      { role: "tool", tool_call_id: "call-1", content: "Artifact created." },
    ]);
  });

  test("degrades a persisted assistant message with toolCalls but no following tool result to plain content", () => {
    // This is the shape of a previous turn's summarized final answer: it carries
    // `toolCalls` purely for the UI's tool-card display, with no `tool` message after it
    // since the exchange already completed. Replaying it as `tool_calls` would produce an
    // orphaned tool_call_id the API rejects on the next request.
    const messages: ChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        content: "Here's what I found.",
        createdAt: "2026-07-11T00:00:00.000Z",
        toolCalls: [
          {
            id: "call-1",
            serverName: "Canvas",
            toolName: "create_artifact",
            status: "completed",
            risk: "write",
            summary: "Create an artifact.",
            arguments: '{"title":"Notes"}',
            result: "Artifact created.",
          },
        ],
      },
      { id: "user-2", role: "user", content: "Thanks, now do something else.", createdAt: "2026-07-11T00:00:00.000Z" },
    ];

    expect(toOpenAIWireMessages(messages)).toEqual([
      { role: "assistant", content: "Here's what I found." },
      { role: "user", content: "Thanks, now do something else." },
    ]);
  });

  test("degrades to plain content when only some of an assistant message's tool calls are answered", () => {
    const messages: ChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        content: "",
        createdAt: "2026-07-11T00:00:00.000Z",
        toolCalls: [
          { id: "call-1", serverName: "Canvas", toolName: "tool_a", status: "completed", risk: "read", summary: "a" },
          { id: "call-2", serverName: "Canvas", toolName: "tool_b", status: "completed", risk: "read", summary: "b" },
        ],
      },
      { id: "tool-1", role: "tool", content: "Result A.", createdAt: "2026-07-11T00:00:00.000Z", toolCallId: "call-1" },
    ];

    expect(toOpenAIWireMessages(messages)).toEqual([
      { role: "assistant", content: "" },
      { role: "tool", tool_call_id: "call-1", content: "Result A." },
    ]);
  });
});
