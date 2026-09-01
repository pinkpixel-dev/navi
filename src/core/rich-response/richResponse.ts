export const richFenceLanguage = "navi-rich";
export const maxRichBlocks = 4;
export const maxRichSourceLength = 50_000;
export const maxRichElements = 300;
export const maxRichDepth = 12;
export const maxTableRows = 50;
export const maxTableColumns = 12;
export const maxCodeBlockLength = 20_000;

export type MessageContentBlock =
  | { type: "markdown"; source: string }
  | { type: "rich"; source: string }
  | { type: "rich-pending" }
  | { type: "rich-error"; source: string; message: string };

const openingFencePattern = /^```navi-rich[ \t]*\r?$/gm;
const closingFencePattern = /^```[ \t]*\r?$/gm;

function appendMarkdown(blocks: MessageContentBlock[], source: string): void {
  if (source) {
    blocks.push({ type: "markdown", source });
  }
}

export function parseMessageContent(content: string, isStreaming = false): MessageContentBlock[] {
  const blocks: MessageContentBlock[] = [];
  let cursor = 0;
  let richBlockCount = 0;

  openingFencePattern.lastIndex = 0;
  for (let opening = openingFencePattern.exec(content); opening; opening = openingFencePattern.exec(content)) {
    if (opening.index < cursor) {
      continue;
    }

    appendMarkdown(blocks, content.slice(cursor, opening.index));
    const sourceStart = opening.index + opening[0].length;
    closingFencePattern.lastIndex = sourceStart;
    const closing = closingFencePattern.exec(content);

    if (!closing) {
      const source = content.slice(sourceStart).replace(/^\r?\n/, "");
      blocks.push(
        isStreaming
          ? { type: "rich-pending" }
          : { type: "rich-error", source, message: "The rich response fence is not complete." },
      );
      cursor = content.length;
      break;
    }

    const source = content.slice(sourceStart, closing.index).replace(/^\r?\n/, "").trimEnd();
    richBlockCount += 1;
    if (richBlockCount > maxRichBlocks) {
      blocks.push({ type: "rich-error", source, message: `A message can contain up to ${maxRichBlocks} rich blocks.` });
    } else if (!source.trim()) {
      blocks.push({ type: "rich-error", source, message: "The rich response is empty." });
    } else if (source.length > maxRichSourceLength) {
      blocks.push({
        type: "rich-error",
        source,
        message: `The rich response is larger than ${maxRichSourceLength.toLocaleString()} characters.`,
      });
    } else {
      blocks.push({ type: "rich", source });
    }

    cursor = closing.index + closing[0].length;
    openingFencePattern.lastIndex = cursor;
  }

  appendMarkdown(blocks, content.slice(cursor));
  return blocks.length ? blocks : [{ type: "markdown", source: content }];
}

export function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function validateRichHeadingLevels(levels: number[]): string | null {
  let previousHeading: number | null = null;
  for (const level of levels) {
    if (previousHeading !== null && level > previousHeading + 1) {
      return "Rich response heading levels must stay in order.";
    }
    previousHeading = level;
  }
  return null;
}
