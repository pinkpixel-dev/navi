import type { ChatMessage, Conversation, MessageAttachment } from "../conversation/types";

export interface UserProfileContext {
  name?: string;
  bio?: string;
}

const seedMessageIds = new Set(["message-welcome", "message-plan", "message-mcp"]);
const internalAssistantMessages = new Set([
  "The run was cancelled.",
  "The run timed out before the provider responded.",
  "The run stopped because the model step limit was reached.",
]);

const artifactProtocol = [
  "When generating standalone HTML, SVG, Mermaid, Markdown documents, or code intended as an artifact, always wrap the complete artifact in a fenced code block with the correct language identifier. Do not output artifact source as unfenced plain text.",
  "Use a fenced Markdown block only when the user explicitly asks for a document, file, artifact, download, or canvas output. Never wrap an ordinary conversational answer in a Markdown fence.",
  "Explanatory text may appear before or after the fenced artifact, but the artifact itself must be entirely contained within the fence.",
  [
    "For HTML:",
    "```html",
    "<!doctype html>",
    '<html lang="en">',
    "<head><title>Example</title></head>",
    "<body><main>Hello</main></body>",
    "</html>",
    "```",
  ].join("\n"),
  [
    "For SVG:",
    "```svg",
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
    '<circle cx="50" cy="50" r="40" />',
    "</svg>",
    "```",
  ].join("\n"),
  ["For Mermaid:", "```mermaid", "graph TD", "  A --> B", "```"].join("\n"),
].join("\n\n");

const defaultSystemPrompt = [
  "Answer the user's latest message directly. Use earlier messages and attachments only as context when they are relevant or when the user asks about them. Do not summarize or answer earlier attachments unless the latest message asks for that.",
  "Write conversational answers as clean, unfenced Markdown. Never wrap a conversational answer in a Markdown code fence. For explanations and comparisons, use a descriptive heading, a short introduction, section headings, lists, and tables when they improve readability.",
  artifactProtocol,
].join("\n\n");

function createTimestamp(): string {
  return new Date().toISOString();
}

function createUserMessage(content: string, attachments?: MessageAttachment[]): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    createdAt: createTimestamp(),
    content,
    ...(attachments?.length ? { attachments } : {}),
  };
}

function createSystemPrompt(
  conversation: Conversation,
  userInstructions?: string,
  userProfile?: UserProfileContext,
  projectInstructions?: string,
): string {
  const contextLines: string[] = [];
  const name = userProfile?.name?.trim();
  const bio = userProfile?.bio?.trim();
  const instructions = userInstructions?.trim();
  const projectContext = projectInstructions?.trim();

  if (name) {
    contextLines.push(`User name: ${name}`);
  }
  if (bio) {
    contextLines.push(`User bio: ${bio}`);
  }
  if (instructions) {
    contextLines.push(`Additional user instructions: ${instructions}`);
  }
  if (projectContext) {
    contextLines.push(`Project instructions for ${conversation.projectName}: ${projectContext}`);
  }
  return contextLines.length ? `${defaultSystemPrompt}\n\n${contextLines.join("\n")}` : defaultSystemPrompt;
}

function createSystemMessage(
  conversation: Conversation,
  userInstructions?: string,
  userProfile?: UserProfileContext,
  projectInstructions?: string,
): ChatMessage {
  return {
    id: "navi-system-latest-message",
    role: "system",
    createdAt: createTimestamp(),
    content: createSystemPrompt(conversation, userInstructions, userProfile, projectInstructions),
  };
}

function isInternalFailureMessage(content: string): boolean {
  return content.startsWith("The provider request failed");
}

function isProviderContextMessage(message: ChatMessage): boolean {
  if (seedMessageIds.has(message.id)) {
    return false;
  }

  if (message.role === "assistant" && (internalAssistantMessages.has(message.content) || isInternalFailureMessage(message.content))) {
    return false;
  }

  return true;
}

export function createProviderMessages(
  conversation: Conversation,
  input: string,
  attachments?: MessageAttachment[],
  userInstructions?: string,
  userProfile?: UserProfileContext,
  projectInstructions?: string,
): ChatMessage[] {
  return [
    createSystemMessage(conversation, userInstructions, userProfile, projectInstructions),
    ...conversation.messages.filter(isProviderContextMessage),
    createUserMessage(input, attachments),
  ];
}
