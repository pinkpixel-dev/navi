import { createElement, Fragment, type MouseEvent, type ReactNode } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { highlightCodeToHtml } from "../canvas/syntaxHighlight";
import {
  maxCodeBlockLength,
  maxRichDepth,
  maxRichElements,
  maxTableColumns,
  maxTableRows,
  safeExternalUrl,
  validateRichHeadingLevels,
} from "../core/rich-response/richResponse";

const richTags = [
  "div", "section", "aside", "h2", "h3", "h4", "p", "strong", "em", "ul", "ol", "li", "blockquote",
  "pre", "code", "table", "thead", "tbody", "tr", "th", "td", "details", "summary", "hr", "br", "a",
];
const markdownTags = [...richTags, "h1", "del", "span"];
const richMarkers = new Set(["response", "card", "callout", "badge", "columns", "steps", "metric", "caption"]);
const calloutTypes = new Set(["info", "tip", "warning", "important"]);

interface RenderedFragment {
  fragment: DocumentFragment;
  error: string | null;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function markdownSource(source: string): string {
  const renderer = new marked.Renderer();
  renderer.code = ({ text, lang }) => {
    const languageClass = lang ? ` language-${lang.replace(/[^a-z0-9_-]/gi, "")}` : "";
    return `<pre><code class="syntax-highlight${languageClass}">${highlightCodeToHtml(text, lang)}</code></pre>`;
  };
  renderer.html = ({ text }) => escapeHtml(text);
  return marked.parse(source, { async: false, renderer }) as string;
}

function sanitizeFragment(source: string, isRich: boolean): DocumentFragment {
  return DOMPurify.sanitize(isRich ? source : markdownSource(source), {
    ALLOWED_TAGS: isRich ? richTags : markdownTags,
    ALLOWED_ATTR: isRich ? ["data-navi", "data-type", "href"] : ["class", "href"],
    ALLOWED_NAMESPACES: ["http://www.w3.org/1999/xhtml"],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    SANITIZE_DOM: true,
    RETURN_DOM_FRAGMENT: true,
  });
}

function elementDepth(element: Element, root: DocumentFragment): number {
  let depth = 1;
  for (let parent = element.parentNode; parent && parent !== root; parent = parent.parentNode) {
    depth += 1;
  }
  return depth;
}

function validateRichFragment(fragment: DocumentFragment): string | null {
  const elements = Array.from(fragment.querySelectorAll("*"));
  if (elements.length > maxRichElements) {
    return `Rich responses can contain up to ${maxRichElements} elements.`;
  }
  if (elements.some((element) => elementDepth(element, fragment) > maxRichDepth)) {
    return `Rich responses can be nested up to ${maxRichDepth} levels.`;
  }
  if (elements.some((element) => element.tagName === "CODE" && (element.textContent?.length ?? 0) > maxCodeBlockLength)) {
    return `A rich code block can contain up to ${maxCodeBlockLength.toLocaleString()} characters.`;
  }

  for (const table of Array.from(fragment.querySelectorAll("table"))) {
    const rows = Array.from(table.querySelectorAll("tr"));
    if (rows.length > maxTableRows || rows.some((row) => row.children.length > maxTableColumns)) {
      return `Rich tables can contain up to ${maxTableRows} rows and ${maxTableColumns} columns.`;
    }
  }

  const headingError = validateRichHeadingLevels(
    Array.from(fragment.querySelectorAll("h2, h3, h4"), (heading) => Number(heading.tagName.slice(1))),
  );
  if (headingError) {
    return headingError;
  }
  return null;
}

function renderFragment(source: string, isRich: boolean): RenderedFragment {
  try {
    const fragment = sanitizeFragment(source, isRich);
    return { fragment, error: isRich ? validateRichFragment(fragment) : null };
  } catch {
    return { fragment: document.createDocumentFragment(), error: "Navi could not parse this formatted response." };
  }
}

function openExternalLink(event: MouseEvent<HTMLAnchorElement>, href: string): void {
  event.preventDefault();
  window.open(href, "_blank", "noopener,noreferrer");
}

function nodeToReact(node: Node, key: string, isRich: boolean): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const element = node as HTMLElement;
  const originalTag = element.tagName.toLowerCase();
  const tag = !isRich && originalTag === "h1" ? "h2" : originalTag;
  const excludesWhitespace = ["table", "thead", "tbody", "tr"].includes(originalTag);
  const children = Array.from(element.childNodes)
    .filter((child) => !excludesWhitespace || child.nodeType !== Node.TEXT_NODE || Boolean(child.textContent?.trim()))
    .map((child, index) => nodeToReact(child, `${key}-${index}`, isRich));
  const props: Record<string, unknown> = { key };

  if (isRich) {
    const marker = element.getAttribute("data-navi");
    if (marker && richMarkers.has(marker)) {
      props["data-navi"] = marker;
      const type = element.getAttribute("data-type");
      if (marker === "callout" && type && calloutTypes.has(type)) {
        props["data-type"] = type;
        children.unshift(createElement("span", { className: "rich-callout-label", key: `${key}-label` }, type));
      }
    }
  } else {
    const className = element.getAttribute("class") ?? "";
    const safeClasses = className.split(/\s+/).filter((name) => /^(syntax-[a-z-]+|language-[a-z0-9_-]+)$/.test(name));
    if (safeClasses.length) {
      props.className = safeClasses.join(" ");
    }
  }

  if (tag === "a") {
    const href = safeExternalUrl(element.getAttribute("href") ?? "");
    if (!href) {
      return createElement("span", { key }, children);
    }
    Object.assign(props, {
      href,
      rel: "noopener noreferrer",
      target: "_blank",
      onClick: (event: MouseEvent<HTMLAnchorElement>) => openExternalLink(event, href),
    });
  }

  return createElement(tag, props, children);
}

export interface MarkdownPresentation {
  intro: string;
  sections: string[];
}

export function planMarkdownPresentation(source: string): MarkdownPresentation | null {
  const tokens = marked.lexer(source);
  const headings = tokens.flatMap((token, index) => {
    return token.type === "heading" ? [{ index, level: token.depth }] : [];
  });
  const firstHeading = headings[0];
  if (!firstHeading) {
    return null;
  }
  const firstSectionHeading = headings.find((heading) => heading.index > firstHeading.index);
  if (!firstSectionHeading) {
    return null;
  }

  const sectionStarts = headings.filter(
    (heading) => heading.index >= firstSectionHeading.index && heading.level === firstSectionHeading.level,
  );
  const intro = tokens.slice(0, sectionStarts[0].index).map((token) => token.raw).join("");
  const sections = sectionStarts.map((section, index) => {
    const end = sectionStarts[index + 1]?.index ?? tokens.length;
    return tokens.slice(section.index, end).map((token) => token.raw).join("");
  });

  return { intro, sections };
}

export function RichMarkup({
  source,
  isRich = false,
  usePresentation = true,
}: {
  source: string;
  isRich?: boolean;
  usePresentation?: boolean;
}) {
  const presentation = !isRich && usePresentation ? planMarkdownPresentation(source) : null;
  if (presentation) {
    return (
      <div className="rich-markdown-response structured">
        <header className="rich-markdown-intro">
          <RichMarkup source={presentation.intro} usePresentation={false} />
        </header>
        <div className="rich-markdown-sections">
          {presentation.sections.map((section, index) => (
            <section className="rich-markdown-card" key={`section-${index}`}>
              <RichMarkup source={section} usePresentation={false} />
            </section>
          ))}
        </div>
      </div>
    );
  }

  const rendered = renderFragment(source, isRich);
  if (rendered.error) {
    return <RichFormattingError message={rendered.error} source={source} />;
  }
  if (!isRich) {
    return <div className="rich-markdown-response">{Array.from(rendered.fragment.childNodes).map((node, index) => nodeToReact(node, `node-${index}`, false))}</div>;
  }
  return <Fragment>{Array.from(rendered.fragment.childNodes).map((node, index) => nodeToReact(node, `node-${index}`, true))}</Fragment>;
}

export function RichFormattingError({ message, source }: { message: string; source: string }) {
  return (
    <div className="rich-response-error" role="status">
      <strong>Rich formatting unavailable</strong>
      <p>{message}</p>
      {source ? <pre><code>{source}</code></pre> : null}
    </div>
  );
}
