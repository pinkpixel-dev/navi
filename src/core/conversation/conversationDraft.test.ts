import { describe, expect, test } from "vitest";
import type { Conversation } from "./types";
import { hasConversationContent, replaceConversationDraft } from "./conversationDraft";

function conversation(id: string, message?: string): Conversation {
  return {
    id,
    title: message ? "Saved chat" : "New chat",
    projectName: "Navi",
    provider: "Test",
    model: "test",
    processing: "local",
    isPinned: false,
    updatedAt: "2026-08-31T00:00:00.000Z",
    messages: message
      ? [{ id: `${id}-message`, role: "user", content: message, createdAt: "2026-08-31T00:00:00.000Z" }]
      : [],
  };
}

describe("conversation drafts", () => {
  test("only treats conversations with messages as content", () => {
    expect(hasConversationContent(conversation("empty"))).toBe(false);
    expect(hasConversationContent(conversation("saved", "Hello"))).toBe(true);
  });

  test("replaces empty drafts while retaining conversations with messages", () => {
    const draft = conversation("new-draft");
    const saved = conversation("saved", "Hello");

    expect(replaceConversationDraft([conversation("old-draft"), saved], draft)).toEqual([draft, saved]);
  });
});
