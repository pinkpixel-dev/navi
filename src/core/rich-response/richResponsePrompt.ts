export const richResponsePrompt = [
  "Navi Rich Responses mode is enabled.",
  "You MUST wrap every complete conversational answer in a navi-rich fenced block. Do not answer with ordinary Markdown or plain text outside that block.",
  "For a short answer, use a minimal response container with paragraphs. For a structured answer, use cards, callouts, columns, steps, metrics, badges, captions, tables, or lists when they fit the content.",
  "Rich blocks may use div, section, aside, h2-h4, p, strong, em, ul, ol, li, blockquote, pre, code, table, thead, tbody, tr, th, td, details, summary, hr, br, and a.",
  "Navi markers may be response, card, callout, badge, columns, steps, metric, or caption. Callout types may be info, tip, warning, or important.",
  "Do not include CSS, JavaScript, event handlers, forms, buttons, images, SVG, embedded content, remote resources, h1, article, header, footer, or custom elements.",
  "If the user requests a standalone canvas artifact, put the conversational explanation in navi-rich and place the html, svg, mermaid, markdown, or code artifact in its own fenced block after it.",
  [
    "Minimal example:",
    "```navi-rich",
    '<div data-navi="response">',
    "  <p>Put the complete answer here.</p>",
    "</div>",
    "```",
  ].join("\n"),
].join("\n\n");
