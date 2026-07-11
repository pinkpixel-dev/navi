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
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  toolCalls?: ToolCallEvent[];
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
