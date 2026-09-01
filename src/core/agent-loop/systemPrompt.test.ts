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

  test("requires rich responses only when the setting is enabled", () => {
    const disabled = createProviderMessages(conversation, "Compare these options.");
    const enabled = createProviderMessages(
      conversation,
      "Compare these options.",
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    );

    expect(disabled[0].content).not.toContain("```navi-rich");
    expect(enabled[0].content).toContain("```navi-rich");
    expect(enabled[0].content).toContain("MUST wrap every complete conversational answer in a navi-rich fenced block");
    expect(enabled[0].content).toContain("Do not answer with ordinary Markdown or plain text outside that block.");
    expect(enabled[0].content).toContain("place the html, svg, mermaid, markdown, or code artifact in its own fenced block");
    expect(disabled.at(-1)?.content).toBe("Compare these options.");
    expect(enabled.at(-1)?.content).toContain("Compare these options.");
    expect(enabled.at(-1)?.content).toContain("Rich Responses is on for this turn.");
    expect(enabled.at(-1)?.content).toContain("Start the answer with ```navi-rich");
  });

  test("does not send rich format failures back to the provider", () => {
    const failedConversation: Conversation = {
      ...conversation,
      messages: [
        {
          id: "rich-format-failure",
          role: "assistant",
          createdAt: "2026-08-31T00:00:00.000Z",
          content:
            "The provider did not return a complete Rich Response. Try again, or turn off Rich Responses in Settings.",
        },
      ],
    };

    const messages = createProviderMessages(failedConversation, "Try again.", undefined, undefined, undefined, undefined, true);
    expect(messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "rich-format-failure" })]),
    );
  });
});
