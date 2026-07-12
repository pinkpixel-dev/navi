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

export interface ProviderToolSchema {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: unknown;
  };
}

export interface ProviderCompleteInput {
  messages: ChatMessage[];
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  tools?: ProviderToolSchema[];
}

export interface ChatProvider {
  id: string;
  label: string;
  model: ProviderModel;
  complete: (input: ProviderCompleteInput) => Promise<ProviderResponse>;
  listModels?: () => Promise<ProviderModel[]>;
}
