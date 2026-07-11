import type { ChatMessage, ToolCallEvent } from "../conversation/types";

export interface ProviderModel {
  id: string;
  name: string;
  provider: string;
  location: "local" | "cloud" | "external";
  capabilities: Array<"tools" | "vision" | "structured-output" | "canvas">;
  contextTokens: number;
}

export interface ProviderResponse {
  message: ChatMessage;
  toolCalls: ToolCallEvent[];
}

export interface ProviderCompleteInput {
  messages: ChatMessage[];
  signal?: AbortSignal;
}

export interface ChatProvider {
  id: string;
  label: string;
  model: ProviderModel;
  complete: (input: ProviderCompleteInput) => Promise<ProviderResponse>;
  listModels?: () => Promise<ProviderModel[]>;
}
