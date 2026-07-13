import { describe, expect, test, vi } from "vitest";
import type { ChatMessage } from "./types";
import type { ProviderCompleteInput } from "../providers/types";
import { generateConversationTitle, sanitizeGeneratedConversationTitle } from "./conversationTitle";

const userMessage: ChatMessage = {
  id: "user-message",
  role: "user",
  content: "Why are my Navi chat names so long?",
  createdAt: "2026-07-12T00:00:00.000Z",
};

const assistantMessage: ChatMessage = {
  id: "assistant-message",
  role: "assistant",
  content: "You can generate a short title after the first assistant response completes.",
  createdAt: "2026-07-12T00:00:00.000Z",
};

describe("conversation title generation", () => {
  test("sanitizes quoted and punctuated provider output", () => {
    expect(sanitizeGeneratedConversationTitle('  "Better Chat Titles."  ')).toBe("Better Chat Titles");
  });

  test("rejects empty generated titles", () => {
    expect(sanitizeGeneratedConversationTitle("   ")).toBeNull();
  });

  test("asks the provider for a concise title and returns sanitized content", async () => {
    let titleInput: ProviderCompleteInput | undefined;
    const providerComplete = vi.fn(async (input: ProviderCompleteInput) => {
      titleInput = input;
      return {
        message: {
          id: "title-message",
          role: "assistant" as const,
          content: "Navi Chat Titles!",
          createdAt: "2026-07-12T00:00:00.000Z",
        },
        toolCalls: [],
      };
    });

    await expect(generateConversationTitle(providerComplete, userMessage, assistantMessage)).resolves.toBe(
      "Navi Chat Titles",
    );
    expect(providerComplete).toHaveBeenCalledOnce();
    expect(titleInput?.messages).toHaveLength(2);
    expect(titleInput?.messages[1]?.content).toContain(userMessage.content);
    expect(titleInput?.messages[1]?.content).toContain(assistantMessage.content);
  });
});
