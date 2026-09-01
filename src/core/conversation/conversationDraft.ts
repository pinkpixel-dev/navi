import type { Conversation } from "./types";

export function hasConversationContent(conversation: Conversation): boolean {
  return conversation.messages.length > 0;
}

export function replaceConversationDraft(
  conversations: Conversation[],
  draft: Conversation,
): Conversation[] {
  return [draft, ...conversations.filter(hasConversationContent)];
}
