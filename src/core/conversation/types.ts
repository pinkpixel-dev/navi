export type MessageRole = "system" | "user" | "assistant" | "tool";

export type ProcessingLocation = "local" | "cloud" | "external";

export type ToolCallStatus = "queued" | "awaiting-approval" | "running" | "completed" | "failed";

export interface ToolCallEvent {
  id: string;
  serverName: string;
  toolName: string;
  status: ToolCallStatus;
  risk: "read" | "write" | "destructive" | "network";
  durationMs?: number;
  summary: string;
  /** Raw JSON arguments string, needed to replay this call back to the model on the next step. */
  arguments?: string;
  /** What the tool actually returned (or the denial reason), for display on persisted messages. */
  result?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  toolCalls?: ToolCallEvent[];
  /** For role: "tool" messages, links this result back to the tool call it answers. */
  toolCallId?: string;
}

export interface Conversation {
  id: string;
  title: string;
  projectName: string;
  provider: string;
  model: string;
  processing: ProcessingLocation;
  isPinned: boolean;
  updatedAt: string;
  messages: ChatMessage[];
}
