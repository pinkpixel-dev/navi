import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { MessageContent } from "./MessageContent";

describe("MessageContent", () => {
  test("keeps an unfinished rich response behind the Thinking state", () => {
    const markup = renderToStaticMarkup(
      <MessageContent content={"```navi-rich\n<div data-navi=\"response\">"} role="assistant" isStreaming />,
    );

    expect(markup).toContain("Thinking...");
    expect(markup).not.toContain("Formatting response");
    expect(markup).not.toContain("data-navi");
  });
});
