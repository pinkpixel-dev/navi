const languageAliases: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  md: "markdown",
  yml: "yaml",
  htm: "html",
};

const keywordLanguages = new Set([
  "javascript",
  "typescript",
  "python",
  "rust",
  "go",
  "java",
  "c",
  "cpp",
  "css",
  "html",
  "xml",
  "yaml",
  "toml",
  "sh",
  "sql",
]);

const codeKeywords = new Set([
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "def",
  "default",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "fn",
  "for",
  "from",
  "function",
  "if",
  "impl",
  "import",
  "in",
  "interface",
  "let",
  "match",
  "mod",
  "mut",
  "new",
  "null",
  "package",
  "private",
  "pub",
  "return",
  "self",
  "static",
  "struct",
  "switch",
  "this",
  "throw",
  "trait",
  "true",
  "try",
  "type",
  "use",
  "var",
  "void",
  "while",
]);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeLanguage(language?: string): string | undefined {
  const normalized = language?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  return languageAliases[normalized] ?? normalized;
}

function span(className: string, value: string): string {
  return `<span class="${className}">${escapeHtml(value)}</span>`;
}

function highlightByPattern(source: string, pattern: RegExp, classify: (match: string) => string): string {
  let html = "";
  let lastIndex = 0;

  for (const match of source.matchAll(pattern)) {
    const value = match[0];
    const index = match.index ?? 0;
    html += escapeHtml(source.slice(lastIndex, index));
    html += span(classify(value), value);
    lastIndex = index + value.length;
  }

  html += escapeHtml(source.slice(lastIndex));
  return html;
}

function highlightJson(source: string): string {
  return highlightByPattern(
    source,
    /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b|\b(?:true|false|null)\b/gi,
    (value) => {
      if (value.startsWith('"') && /"\s*$/.test(value)) {
        return "syntax-property";
      }
      if (value === "true" || value === "false" || value === "null") {
        return "syntax-literal";
      }
      if (/^-?\d/.test(value)) {
        return "syntax-number";
      }
      return "syntax-string";
    },
  );
}

function highlightMarkup(source: string): string {
  return highlightByPattern(
    source,
    /<!--[\s\S]*?-->|<\/?[a-zA-Z][^>\s/]*(?:\s+[^\s=>/]+(?:=(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>|"[^"]*"|'[^']*'/g,
    (value) => {
      if (value.startsWith("<!--")) {
        return "syntax-comment";
      }
      if (value.startsWith("<")) {
        return "syntax-tag";
      }
      return "syntax-string";
    },
  );
}

function highlightMarkdown(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      if (/^#{1,6}\s/.test(line)) {
        return span("syntax-heading", line);
      }
      if (/^```/.test(line)) {
        return span("syntax-fence", line);
      }
      if (/^\s*[-*+]\s/.test(line) || /^\s*\d+\.\s/.test(line)) {
        return span("syntax-list-marker", line.match(/^\s*(?:[-*+]|\d+\.)/)?.[0] ?? "") + escapeHtml(line.replace(/^\s*(?:[-*+]|\d+\.)/, ""));
      }
      return escapeHtml(line);
    })
    .join("\n");
}

function highlightCodeLanguage(source: string, language: string): string {
  const hashCommentPattern = language === "python" || language === "yaml" || language === "toml" || language === "sh" ? "|#.*" : "";
  const pattern = new RegExp(
    `\\/\\/.*${hashCommentPattern}|\\/\\*[\\s\\S]*?\\*\\/|\`(?:\\\\[\\s\\S]|[^\`\\\\])*\`|'(?:\\\\.|[^'\\\\])*'|"(?:\\\\.|[^"\\\\])*"|\\b\\d+(?:\\.\\d+)?\\b|\\b[A-Za-z_][A-Za-z0-9_]*\\b`,
    "g",
  );

  return highlightByPattern(
    source,
    pattern,
    (value) => {
      if (value.startsWith("//") || value.startsWith("#") || value.startsWith("/*")) {
        return "syntax-comment";
      }
      if (value.startsWith('"') || value.startsWith("'") || value.startsWith("`")) {
        return "syntax-string";
      }
      if (/^\d/.test(value)) {
        return "syntax-number";
      }
      if (value === "true" || value === "false" || value === "null" || value === "None" || value === "nil") {
        return "syntax-literal";
      }
      if (codeKeywords.has(value)) {
        return "syntax-keyword";
      }
      return "syntax-identifier";
    },
  );
}

export function highlightCodeToHtml(source: string, language?: string): string {
  const normalizedLanguage = normalizeLanguage(language);

  if (normalizedLanguage === "json") {
    return highlightJson(source);
  }
  if (normalizedLanguage === "html" || normalizedLanguage === "xml" || normalizedLanguage === "svg") {
    return highlightMarkup(source);
  }
  if (normalizedLanguage === "markdown") {
    return highlightMarkdown(source);
  }
  if (normalizedLanguage && keywordLanguages.has(normalizedLanguage)) {
    return highlightCodeLanguage(source, normalizedLanguage);
  }

  return escapeHtml(source);
}
