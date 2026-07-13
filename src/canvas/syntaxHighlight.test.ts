import { describe, expect, test } from "vitest";
import { highlightCodeToHtml } from "./syntaxHighlight";

describe("highlightCodeToHtml", () => {
  test("escapes raw html before adding syntax spans", () => {
    const html = highlightCodeToHtml("<script>alert('x')</script>", "html");

    expect(html).toContain("&lt;");
    expect(html).not.toContain("<script>");
  });

  test("highlights TypeScript keywords, strings, and numbers", () => {
    const html = highlightCodeToHtml("const answer: number = 42;\nreturn 'solid';", "ts");

    expect(html).toContain('<span class="syntax-keyword">const</span>');
    expect(html).toContain('<span class="syntax-keyword">return</span>');
    expect(html).toContain('<span class="syntax-number">42</span>');
    expect(html).toContain('<span class="syntax-string">&#039;solid&#039;</span>');
  });

  test("highlights JSON object keys and literals", () => {
    const html = highlightCodeToHtml('{"enabled": true, "count": 3}', "json");

    expect(html).toContain('<span class="syntax-property">&quot;enabled&quot;</span>');
    expect(html).toContain('<span class="syntax-literal">true</span>');
    expect(html).toContain('<span class="syntax-number">3</span>');
  });

  test("highlights Markdown headings and code fences", () => {
    const html = highlightCodeToHtml("# Notes\n\n```ts\nconst ok = true;\n```", "markdown");

    expect(html).toContain('<span class="syntax-heading"># Notes</span>');
    expect(html).toContain('<span class="syntax-fence">```ts</span>');
  });
});
