import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { MessageContent } from "./MessageContent";
import { planMarkdownPresentation } from "./RichMarkup";

describe("MessageContent", () => {
  test("turns Markdown sections into presentation cards", () => {
    const source = [
      "# Cats: biology and behavior",
      "A practical guide to how cats work.",
      "## Anatomy",
      "Cats have flexible spines.",
      "## Senses",
      "| Sense | Strength |",
      "| --- | --- |",
      "| Hearing | Excellent |",
    ].join("\n\n");
    const presentation = planMarkdownPresentation(source);

    expect(presentation?.intro).toContain("# Cats: biology and behavior");
    expect(presentation?.sections).toHaveLength(2);
    expect(presentation?.sections[0]).toContain("## Anatomy");
    expect(presentation?.sections[1]).toContain("| Sense | Strength |");
  });

  test("keeps short Markdown answers readable without inventing empty cards", () => {
    expect(planMarkdownPresentation("A short answer.")).toBeNull();
    expect(planMarkdownPresentation("# One heading\n\nOne paragraph.")).toBeNull();
  });

  test("keeps an unfinished rich response behind the Thinking state", () => {
    const markup = renderToStaticMarkup(
      <MessageContent content={"```navi-rich\n<div data-navi=\"response\">"} role="assistant" isStreaming />,
    );

    expect(markup).toContain("Thinking...");
    expect(markup).not.toContain("Formatting response");
    expect(markup).not.toContain("data-navi");
  });
});
