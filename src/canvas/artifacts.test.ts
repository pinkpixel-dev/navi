import { describe, expect, test } from "vitest";
import type { ChatMessage } from "../core/conversation/types";
import { createArtifactFromMessage } from "./artifacts";

describe("createArtifactFromMessage", () => {
  test("extracts a fenced markdown artifact from an assistant message", () => {
    const message: ChatMessage = {
      id: "message-1",
      role: "assistant",
      createdAt: "2026-07-11T00:00:00.000Z",
      content: "Here you go.\n\n```markdown\n# Artifact\n\nUseful notes.\n```\n\nDone.",
    };

    expect(createArtifactFromMessage(message)).toEqual({
      id: "message-1-artifact",
      title: "Artifact",
      kind: "markdown",
      source: "# Artifact\n\nUseful notes.",
    });
  });
});
