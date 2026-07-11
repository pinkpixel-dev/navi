import type { ChatMessage } from "../core/conversation/types";

export interface Artifact {
  id: string;
  title: string;
  kind: "markdown" | "text" | "code" | "html" | "svg" | "mermaid";
  source: string;
}

export function createArtifactFromMessage(message?: ChatMessage): Artifact | null {
  if (!message?.content.includes("```markdown")) {
    return null;
  }

  const match = message.content.match(/```markdown\n([\s\S]*?)```/);
  const source = match?.[1]?.trim() ?? message.content;
  const title = source.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "Markdown Artifact";

  return {
    id: `${message.id}-artifact`,
    title,
    kind: "markdown",
    source,
  };
}
