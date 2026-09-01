import { describe, expect, test } from "vitest";
import {
  hasCompleteRichResponse,
  maxRichBlocks,
  maxRichSourceLength,
  parseMessageContent,
  safeExternalUrl,
  validateRichHeadingLevels,
} from "./richResponse";

describe("hasCompleteRichResponse", () => {
  test("accepts a complete rich block", () => {
    expect(hasCompleteRichResponse("```navi-rich\n<section><h2>Hello</h2></section>\n```")).toBe(true);
  });

  test("rejects Markdown-only and unfinished rich responses", () => {
    expect(hasCompleteRichResponse("## Hello\n\nThis is Markdown.")).toBe(false);
    expect(hasCompleteRichResponse("```navi-rich\n<section>Incomplete</section>")).toBe(false);
  });

  test("rejects conversational text outside the single rich block", () => {
    const richBlock = "```navi-rich\n<section><p>Hello</p></section>\n```";
    expect(hasCompleteRichResponse(`Intro\n${richBlock}`)).toBe(false);
    expect(hasCompleteRichResponse(`${richBlock}\nMore Markdown.`)).toBe(false);
    expect(hasCompleteRichResponse(`${richBlock}\n${richBlock}`)).toBe(false);
  });

  test("allows a separate fenced canvas artifact after the rich answer", () => {
    const response = [
      "```navi-rich",
      "<section><p>I made the page.</p></section>",
      "```",
      "```html",
      "<!doctype html><html><body>Hello</body></html>",
      "```",
    ].join("\n");
    expect(hasCompleteRichResponse(response)).toBe(true);
  });
});

describe("parseMessageContent", () => {
  test("keeps Markdown around a complete rich block", () => {
    expect(parseMessageContent("Before\n```navi-rich\n<section><h2>Hi</h2></section>\n```\nAfter")).toEqual([
      { type: "markdown", source: "Before\n" },
      { type: "rich", source: "<section><h2>Hi</h2></section>" },
      { type: "markdown", source: "\nAfter" },
    ]);
  });

  test("does not treat ordinary HTML or other fences as rich content", () => {
    const content = "<section>Example</section>\n```html\n<main>Artifact</main>\n```";
    expect(parseMessageContent(content)).toEqual([{ type: "markdown", source: content }]);
  });

  test("shows a stable pending block while a rich fence streams", () => {
    expect(parseMessageContent("Intro\n```navi-rich\n<section>", true)).toEqual([
      { type: "markdown", source: "Intro\n" },
      { type: "rich-pending" },
    ]);
  });

  test("preserves unfinished source after a completed run", () => {
    expect(parseMessageContent("```navi-rich\n<script>bad()</script>")).toEqual([
      {
        type: "rich-error",
        source: "<script>bad()</script>",
        message: "The rich response fence is not complete.",
      },
    ]);
  });

  test("rejects oversized and excess rich blocks", () => {
    const oversized = `\`\`\`navi-rich\n${"x".repeat(maxRichSourceLength + 1)}\n\`\`\``;
    expect(parseMessageContent(oversized)[0].type).toBe("rich-error");

    const blocks = Array.from({ length: maxRichBlocks + 1 }, () => "```navi-rich\n<p>Hi</p>\n```").join("\n");
    expect(parseMessageContent(blocks).at(-1)).toMatchObject({ type: "rich-error" });
  });
});

describe("safeExternalUrl", () => {
  test("allows HTTP and HTTPS URLs", () => {
    expect(safeExternalUrl("https://example.com/docs")).toBe("https://example.com/docs");
    expect(safeExternalUrl("http://localhost:1420/test")).toBe("http://localhost:1420/test");
  });

  test("blocks active, local, and malformed URLs", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,bad")).toBeNull();
    expect(safeExternalUrl("file:///tmp/private")).toBeNull();
    expect(safeExternalUrl("/relative")).toBeNull();
  });
});

describe("validateRichHeadingLevels", () => {
  test("accepts any permitted level as the first heading", () => {
    expect(validateRichHeadingLevels([3, 3, 3])).toBeNull();
    expect(validateRichHeadingLevels([4])).toBeNull();
  });

  test("rejects a skipped level after the heading hierarchy starts", () => {
    expect(validateRichHeadingLevels([2, 4])).toBe("Rich response heading levels must stay in order.");
    expect(validateRichHeadingLevels([3, 2, 4])).toBe("Rich response heading levels must stay in order.");
  });
});
