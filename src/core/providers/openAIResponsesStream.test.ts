import { describe, expect, test, vi } from "vitest";
import type { ChatMessage } from "../conversation/types";
import {
  streamOpenAIResponse,
  toOpenAIResponsesInput,
  toOpenAIResponsesTools,
} from "./openAIResponsesStream";
import type { ProviderToolSchema } from "./types";

function sseResponse(chunks: unknown[], status = 200): Response {
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

describe("openAIResponsesStream", () => {
  describe("toOpenAIResponsesInput", () => {
    test("converts system messages to developer role items", () => {
      const messages: ChatMessage[] = [
        {
          id: "1",
          role: "system",
          content: "You are an assistant.",
          createdAt: "2026-07-11T00:00:00.000Z",
        },
      ];

      const input = toOpenAIResponsesInput(messages);
      expect(input).toEqual([
        {
          role: "developer",
          content: "You are an assistant.",
        },
      ]);
    });

    test("converts user messages with text and image attachments", () => {
      const messages: ChatMessage[] = [
        {
          id: "1",
          role: "user",
          content: "Explain this diagram",
          createdAt: "2026-07-11T00:00:00.000Z",
          attachments: [
            {
              id: "att-1",
              kind: "image",
              name: "diagram.png",
              mimeType: "image/png",
              data: "iVBORw0KGgoAAAANSUhEUg==",
            },
            {
              id: "att-2",
              kind: "text",
              name: "notes.txt",
              mimeType: "text/plain",
              data: "Some background notes",
            },
          ],
        },
      ];

      const input = toOpenAIResponsesInput(messages);
      expect(input).toEqual([
        {
          role: "user",
          content: [
            {
              type: "input_image",
              image_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
            },
            {
              type: "input_text",
              text: 'Attached file "notes.txt":\n\nSome background notes',
            },
            {
              type: "input_text",
              text: "Explain this diagram",
            },
          ],
        },
      ]);
    });

    test("converts answered assistant tool calls to function_call items and results to function_call_output items", () => {
      const messages: ChatMessage[] = [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Checking the weather for you.",
          createdAt: "2026-07-11T00:00:00.000Z",
          toolCalls: [
            {
              id: "call_123",
              serverName: "weather",
              toolName: "get_weather",
              status: "completed",
              risk: "read",
              summary: "Get weather",
              arguments: '{"location":"Paris"}',
            },
          ],
        },
        {
          id: "tool-1",
          role: "tool",
          content: '{"temp": 22}',
          createdAt: "2026-07-11T00:00:01.000Z",
          toolCallId: "call_123",
        },
      ];

      const input = toOpenAIResponsesInput(messages);
      expect(input).toEqual([
        {
          role: "assistant",
          content: "Checking the weather for you.",
        },
        {
          type: "function_call",
          call_id: "call_123",
          name: "get_weather",
          arguments: '{"location":"Paris"}',
        },
        {
          type: "function_call_output",
          call_id: "call_123",
          output: '{"temp": 22}',
        },
      ]);
    });

    test("degrades unanswered tool calls to plain assistant message", () => {
      const messages: ChatMessage[] = [
        {
          id: "assistant-1",
          role: "assistant",
          content: "I asked about the weather earlier.",
          createdAt: "2026-07-11T00:00:00.000Z",
          toolCalls: [
            {
              id: "call_unanswered",
              serverName: "weather",
              toolName: "get_weather",
              status: "failed",
              risk: "read",
              summary: "Get weather",
            },
          ],
        },
      ];

      const input = toOpenAIResponsesInput(messages);
      expect(input).toEqual([
        {
          role: "assistant",
          content: "I asked about the weather earlier.",
        },
      ]);
    });
  });

  describe("toOpenAIResponsesTools", () => {
    test("converts provider tool schemas to internally tagged Responses tools with strict: false", () => {
      const tools: ProviderToolSchema[] = [
        {
          type: "function",
          function: {
            name: "calculate",
            description: "Perform a calculation",
            parameters: {
              type: "object",
              properties: { expression: { type: "string" } },
              required: ["expression"],
            },
          },
        },
      ];

      const responsesTools = toOpenAIResponsesTools(tools);
      expect(responsesTools).toEqual([
        {
          type: "function",
          name: "calculate",
          description: "Perform a calculation",
          parameters: {
            type: "object",
            properties: { expression: { type: "string" } },
            required: ["expression"],
          },
          strict: false,
        },
      ]);
    });

    test("returns undefined when tool list is empty", () => {
      expect(toOpenAIResponsesTools([])).toBeUndefined();
      expect(toOpenAIResponsesTools(undefined)).toBeUndefined();
    });
  });

  describe("streamOpenAIResponse", () => {
    test("streams text tokens from response.output_text.delta events", async () => {
      const fetcher = vi.fn(async () =>
        sseResponse([
          { type: "response.created" },
          { type: "response.output_text.delta", delta: "Hello" },
          { type: "response.output_text.delta", delta: " from " },
          { type: "response.output_text.delta", delta: "Responses API!" },
          { type: "response.completed" },
        ]),
      );

      const deltas: string[] = [];
      const result = await streamOpenAIResponse({
        fetcher,
        url: "https://api.openai.com/v1/responses",
        headers: { Authorization: "Bearer test-key" },
        body: { model: "gpt-5.6-luna", input: "Hi", stream: true },
        errorPrefix: "OpenAI provider request failed",
        onDelta: (delta) => deltas.push(delta),
      });

      expect(deltas).toEqual(["Hello", " from ", "Responses API!"]);
      expect(result.content).toBe("Hello from Responses API!");
      expect(result.toolCalls).toEqual([]);
    });

    test("accumulates streamed function call deltas and finalizes call_id", async () => {
      const fetcher = vi.fn(async () =>
        sseResponse([
          {
            type: "response.output_item.added",
            output_index: 0,
            item: {
              type: "function_call",
              id: "fc_1",
              call_id: "call_abc123",
              name: "read_file",
              arguments: "",
            },
          },
          {
            type: "response.function_call_arguments.delta",
            output_index: 0,
            delta: '{"path":',
          },
          {
            type: "response.function_call_arguments.delta",
            output_index: 0,
            delta: ' "README.md"}',
          },
          {
            type: "response.function_call_arguments.done",
            output_index: 0,
            call_id: "call_abc123",
            name: "read_file",
            arguments: '{"path": "README.md"}',
          },
          {
            type: "response.completed",
          },
        ]),
      );

      const result = await streamOpenAIResponse({
        fetcher,
        url: "https://api.openai.com/v1/responses",
        headers: { Authorization: "Bearer test-key" },
        body: { model: "gpt-5.6-luna", input: "Read file", stream: true },
        errorPrefix: "OpenAI provider request failed",
        onDelta: () => {},
      });

      expect(result.toolCalls).toEqual([
        {
          id: "call_abc123",
          call_id: "call_abc123",
          function: {
            name: "read_file",
            arguments: '{"path": "README.md"}',
          },
        },
      ]);
    });

    test("throws an actionable error when HTTP status is not ok", async () => {
      const fetcher = vi.fn(async () => new Response("Invalid model", { status: 400 }));

      await expect(
        streamOpenAIResponse({
          fetcher,
          url: "https://api.openai.com/v1/responses",
          headers: {},
          body: {},
          errorPrefix: "OpenAI provider request failed",
          onDelta: () => {},
        }),
      ).rejects.toThrow("OpenAI provider request failed with 400: Invalid model");
    });
  });
});
