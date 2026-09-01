import { describe, expect, test } from "vitest";
import type { Conversation } from "../core/conversation/types";
import { createConversationRepository, createMemoryPersistenceDriver } from "./conversationRepository";

const conversation: Conversation = {
  id: "chat-1",
  title: "SQLite test",
  projectName: "Navi",
  provider: "Test provider",
  model: "test-model",
  processing: "local",
  isPinned: true,
  updatedAt: "Today",
  messages: [
    {
      id: "message-1",
      role: "user",
      content: "Persist this.",
      createdAt: "2026-07-11T00:00:00.000Z",
    },
  ],
};

describe("conversation repository", () => {
  test("saves and loads conversation snapshots through its driver", async () => {
    const repository = createConversationRepository(createMemoryPersistenceDriver());

    await repository.saveConversation({
      conversation,
      runEvents: [],
      artifacts: [],
    });

    await repository.saveConversation({
      conversation: {
        ...conversation,
        id: "chat-2",
        title: "Second chat",
        isPinned: false,
      },
      runEvents: [],
      artifacts: [],
    });

    const snapshots = await repository.loadConversations();

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].conversation.title).toBe("Second chat");
    expect(snapshots[1].conversation).toEqual(conversation);
  });

  test("deletes a conversation snapshot through its driver", async () => {
    const repository = createConversationRepository(createMemoryPersistenceDriver());

    await repository.saveConversation({ conversation, runEvents: [], artifacts: [] });
    await repository.saveConversation({
      conversation: { ...conversation, id: "chat-2", title: "Second chat" },
      runEvents: [],
      artifacts: [],
    });

    await repository.deleteConversation("chat-1");

    const snapshots = await repository.loadConversations();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].conversation.id).toBe("chat-2");
  });

  test("does not persist an empty conversation draft", async () => {
    const repository = createConversationRepository(createMemoryPersistenceDriver());

    await repository.saveConversation({
      conversation: { ...conversation, id: "empty-chat", title: "New chat", messages: [] },
      runEvents: [],
      artifacts: [],
    });

    expect(await repository.loadConversations()).toEqual([]);
  });
});
