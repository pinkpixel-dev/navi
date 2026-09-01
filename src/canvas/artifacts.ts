import type { ChatMessage, Conversation } from "../core/conversation/types";

export type ArtifactKind = "markdown" | "text" | "code" | "html" | "svg" | "mermaid" | "image";

export interface Artifact {
  id: string;
  title: string;
  kind: ArtifactKind;
  source: string;
  language?: string;
  messageId?: string;
  createdAt?: string;
}

/** All revisions of the "same" artifact (matched by kind + title), oldest first. */
export interface ArtifactGroup {
  key: string;
  title: string;
  kind: ArtifactKind;
  revisions: Artifact[];
}

const fenceLanguageKinds: Record<string, ArtifactKind> = {
  markdown: "markdown",
  md: "markdown",
  html: "html",
  svg: "svg",
  mermaid: "mermaid",
};

const imagePattern = /!\[([^\]]*)\]\((data:image\/[^)\s]+|https?:\/\/[^)\s]+\.(?:png|jpe?g|gif|webp))\)/g;
const fencePattern = /```([^\n`]*)\n([\s\S]*?)```/g;
const htmlDocumentStartPattern = /<!doctype\s+html\b[^>]*>|<html\b[^>]*>/i;
const svgDocumentStartPattern = /<svg\b[^>]*>/i;

function detectFenceKind(language: string, source: string): { kind: ArtifactKind; language?: string } {
  const normalized = language.trim().toLowerCase();
  if (normalized && fenceLanguageKinds[normalized]) {
    return { kind: fenceLanguageKinds[normalized] };
  }
  if (normalized) {
    return { kind: "code", language: normalized };
  }

  const trimmedSource = source.trimStart().toLowerCase();
  if (trimmedSource.startsWith("<svg")) {
    return { kind: "svg" };
  }
  if (trimmedSource.startsWith("<!doctype html") || trimmedSource.startsWith("<html")) {
    return { kind: "html" };
  }
  return { kind: "text" };
}

function artifactTitle(kind: ArtifactKind, source: string, language?: string): string {
  if (kind === "markdown") {
    return source.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "Markdown Artifact";
  }
  if (kind === "html") {
    return source.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() ?? "HTML Artifact";
  }
  if (kind === "svg") {
    return "SVG Artifact";
  }
  if (kind === "mermaid") {
    return "Mermaid Diagram";
  }
  if (kind === "code") {
    return language ? `Code (${language})` : "Code Artifact";
  }
  if (kind === "image") {
    return "Image";
  }
  return "Text Artifact";
}

function extractCompleteRootDocument(content: string, startPattern: RegExp, closingTag: string): string | null {
  const startMatch = startPattern.exec(content);
  if (!startMatch) {
    return null;
  }

  const closingIndex = content.toLowerCase().lastIndexOf(closingTag);
  if (closingIndex < startMatch.index + startMatch[0].length) {
    return null;
  }

  return content.slice(startMatch.index, closingIndex + closingTag.length).trim();
}

function detectUnfencedDocument(content: string): { kind: "html" | "svg"; source: string } | null {
  const html = extractCompleteRootDocument(content, htmlDocumentStartPattern, "</html>");
  if (html && /<html\b[^>]*>/i.test(html)) {
    return { kind: "html", source: html };
  }

  const svg = extractCompleteRootDocument(content, svgDocumentStartPattern, "</svg>");
  return svg ? { kind: "svg", source: svg } : null;
}

/** Extracts every renderable artifact (fenced blocks and images) from one message. */
export function extractArtifactsFromMessage(message?: ChatMessage): Artifact[] {
  if (!message || message.role !== "assistant" || !message.content) {
    return [];
  }

  const artifacts: Artifact[] = [];
  let fenceIndex = 0;
  let hasFencedContent = false;

  for (const match of message.content.matchAll(fencePattern)) {
    hasFencedContent = true;
    const [, language, body] = match;
    const source = body.trim();
    if (language.trim().toLowerCase() === "navi-rich") {
      fenceIndex += 1;
      continue;
    }
    if (!source) {
      fenceIndex += 1;
      continue;
    }

    const detected = detectFenceKind(language ?? "", source);
    artifacts.push({
      id: fenceIndex === 0 ? `${message.id}-artifact` : `${message.id}-artifact-${fenceIndex}`,
      title: artifactTitle(detected.kind, source, detected.language),
      kind: detected.kind,
      source,
      ...(detected.language ? { language: detected.language } : {}),
      messageId: message.id,
      createdAt: message.createdAt,
    });
    fenceIndex += 1;
  }

  if (artifacts.length === 0 && !hasFencedContent) {
    const detected = detectUnfencedDocument(message.content);
    if (detected) {
      artifacts.push({
        id: `${message.id}-artifact`,
        title: artifactTitle(detected.kind, detected.source),
        kind: detected.kind,
        source: detected.source,
        messageId: message.id,
        createdAt: message.createdAt,
      });
    }
  }

  let imageIndex = 0;
  for (const match of message.content.matchAll(imagePattern)) {
    const [, alt, url] = match;
    artifacts.push({
      id: `${message.id}-image-${imageIndex}`,
      title: alt.trim() || "Image",
      kind: "image",
      source: url,
      messageId: message.id,
      createdAt: message.createdAt,
    });
    imageIndex += 1;
  }

  return artifacts;
}

/**
 * Kept for callers that want "the artifact" for a message. Returns the first
 * fenced artifact, matching the original single-artifact behavior.
 */
export function createArtifactFromMessage(message?: ChatMessage): Artifact | null {
  const [first] = extractArtifactsFromMessage(message);
  if (!first) {
    return null;
  }
  const { messageId: _messageId, createdAt: _createdAt, ...compact } = first;
  return message && first.id === `${message.id}-artifact` ? compact : first;
}

/** Every artifact across the conversation, in message order (oldest first). */
export function collectConversationArtifacts(conversation: Conversation): Artifact[] {
  return conversation.messages.flatMap((message) => extractArtifactsFromMessage(message));
}

/**
 * Groups a conversation's artifacts into revision histories. Artifacts with the same
 * kind + title (e.g. a markdown doc the model kept editing) become one group whose
 * revisions are ordered oldest → newest.
 */
export function groupArtifactRevisions(artifacts: Artifact[]): ArtifactGroup[] {
  const groups = new Map<string, ArtifactGroup>();

  for (const artifact of artifacts) {
    const key = `${artifact.kind}:${artifact.language ?? ""}:${artifact.title}`;
    const existing = groups.get(key);
    if (existing) {
      existing.revisions.push(artifact);
    } else {
      groups.set(key, {
        key,
        title: artifact.title,
        kind: artifact.kind,
        revisions: [artifact],
      });
    }
  }

  return Array.from(groups.values());
}

const kindExtensions: Record<ArtifactKind, string> = {
  markdown: "md",
  text: "txt",
  code: "txt",
  html: "html",
  svg: "svg",
  mermaid: "mmd",
  image: "png",
};

const languageExtensions: Record<string, string> = {
  javascript: "js",
  typescript: "ts",
  python: "py",
  rust: "rs",
  ruby: "rb",
  shell: "sh",
  bash: "sh",
  csharp: "cs",
  "c++": "cpp",
  cpp: "cpp",
  c: "c",
  go: "go",
  java: "java",
  kotlin: "kt",
  swift: "swift",
  php: "php",
  json: "json",
  yaml: "yaml",
  yml: "yml",
  toml: "toml",
  css: "css",
  sql: "sql",
};

/** Suggested download filename for an artifact, derived from its title and kind. */
export function artifactFileName(artifact: Artifact): string {
  const base = artifact.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "artifact";

  if (artifact.kind === "image") {
    const dataUriMatch = artifact.source.match(/^data:image\/([a-z0-9+]+)/i);
    if (dataUriMatch) {
      return `${base}.${dataUriMatch[1] === "svg+xml" ? "svg" : dataUriMatch[1]}`;
    }
    const urlMatch = artifact.source.match(/\.(png|jpe?g|gif|webp)(?:\?|$)/i);
    return `${base}.${urlMatch?.[1] ?? "png"}`;
  }

  const extension =
    (artifact.language ? languageExtensions[artifact.language] ?? artifact.language : undefined) ??
    kindExtensions[artifact.kind];
  return `${base}.${extension}`;
}
