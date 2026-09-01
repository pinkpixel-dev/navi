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
    expect(systemMessage?.content).toContain(
      "Use a fenced Markdown block only when the user explicitly asks for a document, file, artifact, download, or canvas output.",
    );
    expect(systemMessage?.content).toContain("Explanatory text may appear before or after the fenced artifact");
    expect(systemMessage?.content).toContain("```html\n<!doctype html>");
    expect(systemMessage?.content).toContain("```svg\n<svg");
    expect(systemMessage?.content).toContain("```mermaid\ngraph TD");
  });

  test("requests structured Markdown without changing the user message", () => {
    const messages = createProviderMessages(conversation, "Compare these options.");

    expect(messages[0].content).toContain("Write conversational answers as clean, unfenced Markdown.");
    expect(messages[0].content).toContain("Never wrap a conversational answer in a Markdown code fence.");
    expect(messages[0].content).toContain("section headings, lists, and tables when they improve readability");
    expect(messages[0].content).not.toContain("```navi-rich");
    expect(messages.at(-1)?.content).toBe("Compare these options.");
  });
});
