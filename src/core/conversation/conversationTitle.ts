import type { ChatMessage } from "./types";
import type { ProviderCompleteInput, ProviderResponse } from "../providers/types";

type ProviderComplete = (input: ProviderCompleteInput) => Promise<ProviderResponse>;

const maxTitleInputLength = 2400;
const maxTitleLength = 60;

function truncateForTitlePrompt(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= maxTitleInputLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxTitleInputLength).trim()}...`;
}

export function sanitizeGeneratedConversationTitle(rawTitle: string): string | null {
  const title = rawTitle
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?;:]+$/g, "")
    .trim();

  if (!title || title.length < 2) {
    return null;
  }

  return title.length > maxTitleLength ? title.slice(0, maxTitleLength).trim() : title;
}

export async function generateConversationTitle(
  providerComplete: ProviderComplete,
  userMessage: ChatMessage,
  assistantMessage: ChatMessage,
): Promise<string | null> {
  const response = await providerComplete({
    messages: [
      {
        id: "navi-title-system",
        role: "system",
        createdAt: new Date().toISOString(),
        content:
          "Create a concise chat title. Use 3 to 6 words. Do not use quotes. Do not add trailing punctuation. Return only the title.",
      },
      {
        id: "navi-title-user",
        role: "user",
        createdAt: new Date().toISOString(),
        content: [
          "Create a title for this conversation.",
          "",
          `User message:\n${truncateForTitlePrompt(userMessage.content)}`,
          "",
          `Assistant response:\n${truncateForTitlePrompt(assistantMessage.content)}`,
        ].join("\n"),
      },
    ],
  });

  return sanitizeGeneratedConversationTitle(response.message.content);
}
