import { describe, expect, test } from "vitest";
import type { Conversation } from "../conversation/types";
import { createProviderMessages } from "./systemPrompt";

const conversation: Conversation = {
  id: "conversation-1",
  title: "Artifact test",
  projectName: "Navi",
  provider: "Test",
  model: "test",
  processing: "local",
  isPinned: false,
  updatedAt: "2026-08-31T00:00:00.000Z",
  messages: [],
};

describe("createProviderMessages", () => {
  test("includes the provider-neutral artifact protocol in the system message", () => {
    const messages = createProviderMessages(conversation, "Create an artifact.");
    const systemMessage = messages.find((message) => message.role === "system");

    expect(systemMessage?.content).toContain("always wrap the complete artifact in a fenced code block");
    expect(systemMessage?.content).toContain("Do not output artifact source as unfenced plain text.");
    expect(systemMessage?.content).toContain("Explanatory text may appear before or after the fenced artifact");
    expect(systemMessage?.content).toContain("```html\n<!doctype html>");
    expect(systemMessage?.content).toContain("```svg\n<svg");
    expect(systemMessage?.content).toContain("```mermaid\ngraph TD");
  });
});
