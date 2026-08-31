import { describe, expect, test } from "vitest";
import type { ChatMessage, Conversation } from "../core/conversation/types";
import {
  artifactFileName,
  collectConversationArtifacts,
  createArtifactFromMessage,
  extractArtifactsFromMessage,
  groupArtifactRevisions,
} from "./artifacts";

function assistantMessage(id: string, content: string): ChatMessage {
  return { id, role: "assistant", createdAt: "2026-07-11T00:00:00.000Z", content };
}

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

describe("extractArtifactsFromMessage", () => {
  test("extracts html, svg, mermaid, and code artifacts by fence language", () => {
    const message = assistantMessage(
      "m1",
      [
        "```html\n<h1>Hi</h1>\n```",
        "```svg\n<svg xmlns='http://www.w3.org/2000/svg'></svg>\n```",
        "```mermaid\ngraph TD; A-->B;\n```",
        "```python\nprint('hi')\n```",
      ].join("\n\n"),
    );

    const artifacts = extractArtifactsFromMessage(message);
    expect(artifacts.map((artifact) => artifact.kind)).toEqual(["html", "svg", "mermaid", "code"]);
    expect(artifacts[3].language).toBe("python");
    expect(artifacts[3].title).toBe("Code (python)");
  });

  test("detects svg and html in unlabeled fences", () => {
    const message = assistantMessage("m2", "```\n<svg viewBox='0 0 1 1'></svg>\n```\n\n```\n<!DOCTYPE html><html></html>\n```");

    const artifacts = extractArtifactsFromMessage(message);
    expect(artifacts.map((artifact) => artifact.kind)).toEqual(["svg", "html"]);
  });

  test("recovers a complete unfenced HTML document and excludes surrounding explanation", () => {
    const message = assistantMessage(
      "m-html",
      [
        "Save this as a page:",
        "<!doctype html>",
        '<html lang="en"><head><title>Recovered page</title></head><body>Hello</body></html>',
        "The page is ready.",
      ].join("\n"),
    );

    expect(extractArtifactsFromMessage(message)).toEqual([
      expect.objectContaining({
        id: "m-html-artifact",
        kind: "html",
        title: "Recovered page",
        source:
          '<!doctype html>\n<html lang="en"><head><title>Recovered page</title></head><body>Hello</body></html>',
      }),
    ]);
  });

  test("recovers complete HTML without a doctype and a standalone SVG", () => {
    const html = assistantMessage("m-html-root", "Here it is:\n<html><body>Page</body></html>");
    const svg = assistantMessage(
      "m-svg",
      "Logo source:\n<svg viewBox='0 0 10 10'><circle cx='5' cy='5' r='4' /></svg>\nDone.",
    );

    expect(extractArtifactsFromMessage(html)[0]).toMatchObject({ kind: "html", source: "<html><body>Page</body></html>" });
    expect(extractArtifactsFromMessage(svg)[0]).toMatchObject({
      kind: "svg",
      source: "<svg viewBox='0 0 10 10'><circle cx='5' cy='5' r='4' /></svg>",
    });
  });

  test("does not infer partial documents, fragments, or unfenced Mermaid", () => {
    expect(extractArtifactsFromMessage(assistantMessage("m-fragment", "<div>Hello</div>"))).toEqual([]);
    expect(extractArtifactsFromMessage(assistantMessage("m-html-open", "<!doctype html><html><body>Hello"))).toEqual([]);
    expect(extractArtifactsFromMessage(assistantMessage("m-html-rootless", "<!doctype html><body>Hello</body></html>"))).toEqual(
      [],
    );
    expect(extractArtifactsFromMessage(assistantMessage("m-svg-open", "<svg><circle /></svg-ish>"))).toEqual([]);
    expect(extractArtifactsFromMessage(assistantMessage("m-mermaid", "graph TD\nA --> B"))).toEqual([]);
  });

  test("keeps fenced artifacts authoritative and does not add an unfenced duplicate", () => {
    const message = assistantMessage("m-fenced", "```html\n<html><body>Page</body></html>\n```");

    expect(extractArtifactsFromMessage(message)).toHaveLength(1);
  });

  test("does not let an image reference suppress unfenced document recovery", () => {
    const message = assistantMessage(
      "m-html-image",
      "![Reference](https://example.com/reference.png)\n<!doctype html><html><body>Page</body></html>",
    );

    expect(extractArtifactsFromMessage(message).map((artifact) => artifact.kind)).toEqual(["html", "image"]);
  });

  test("extracts markdown image references as image artifacts", () => {
    const message = assistantMessage("m3", "Look: ![A chart](data:image/png;base64,aGk=)");

    const artifacts = extractArtifactsFromMessage(message);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ kind: "image", title: "A chart", source: "data:image/png;base64,aGk=" });
  });

  test("ignores user messages and messages without artifacts", () => {
    expect(extractArtifactsFromMessage({ ...assistantMessage("m4", "plain text") })).toEqual([]);
    expect(extractArtifactsFromMessage({ ...assistantMessage("m5", "```python\nx=1\n```"), role: "user" })).toEqual([]);
  });
});

describe("artifact revision history", () => {
  test("collects artifacts across a conversation and groups revisions by kind and title", () => {
    const conversation: Conversation = {
      id: "c1",
      title: "Chat",
      projectName: "Navi",
      provider: "Test",
      model: "test",
      processing: "local",
      isPinned: false,
      updatedAt: "2026-07-11T00:00:00.000Z",
      messages: [
        assistantMessage("m1", "```markdown\n# Notes\n\nv1\n```"),
        { id: "u1", role: "user", content: "Revise it", createdAt: "2026-07-11T00:00:01.000Z" },
        assistantMessage("m2", "```markdown\n# Notes\n\nv2\n```"),
        assistantMessage("m3", "```python\nprint('hi')\n```"),
      ],
    };

    const artifacts = collectConversationArtifacts(conversation);
    expect(artifacts).toHaveLength(3);

    const groups = groupArtifactRevisions(artifacts);
    expect(groups).toHaveLength(2);
    expect(groups[0].title).toBe("Notes");
    expect(groups[0].revisions.map((revision) => revision.source)).toEqual(["# Notes\n\nv1", "# Notes\n\nv2"]);
    expect(groups[1].kind).toBe("code");
  });
});

describe("artifactFileName", () => {
  test("derives filenames from titles, kinds, and languages", () => {
    expect(artifactFileName({ id: "a", title: "My Notes", kind: "markdown", source: "" })).toBe("my-notes.md");
    expect(artifactFileName({ id: "b", title: "Code (python)", kind: "code", language: "python", source: "" })).toBe(
      "code-python.py",
    );
    expect(artifactFileName({ id: "c", title: "Image", kind: "image", source: "data:image/png;base64,aGk=" })).toBe(
      "image.png",
    );
    expect(artifactFileName({ id: "d", title: "Mermaid Diagram", kind: "mermaid", source: "" })).toBe(
      "mermaid-diagram.mmd",
    );
  });
});
