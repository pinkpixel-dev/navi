import type { ChatMessage, ToolCallEvent } from "../conversation/types";
import type { RunEvent, RunStatus } from "../agent-loop/types";

export interface ChatToolState extends ToolCallEvent {
  result?: string;
  denialReason?: string;
}

export interface ChatRunState {
  status: RunStatus;
  events: RunEvent[];
  pendingAssistantMessage: ChatMessage | null;
  completedAssistantMessage: ChatMessage | null;
  toolCalls: ChatToolState[];
  failure: string | null;
}

export type ChatRunAction =
  | {
      type: "reset";
    }
  | {
      type: "event";
      event: RunEvent;
    };

export function createInitialChatRunState(): ChatRunState {
  return {
    status: "idle",
    events: [],
    pendingAssistantMessage: null,
    completedAssistantMessage: null,
    toolCalls: [],
    failure: null,
  };
}

function createPendingAssistant(delta: string, event: RunEvent): ChatMessage {
  return {
    id: "pending-assistant-message",
    role: "assistant",
    createdAt: event.timestamp,
    content: delta,
  };
}

function upsertToolCall(
  toolCalls: ChatToolState[],
  toolCall: ToolCallEvent,
  patch: Partial<ChatToolState> = {},
): ChatToolState[] {
  const nextToolCall = { ...toolCall, ...patch };
  const existingIndex = toolCalls.findIndex((currentToolCall) => currentToolCall.id === toolCall.id);

  if (existingIndex === -1) {
    return [...toolCalls, nextToolCall];
  }

  return toolCalls.map((currentToolCall, index) => (index === existingIndex ? nextToolCall : currentToolCall));
}

export function applyRunEvent(state: ChatRunState, event: RunEvent): ChatRunState {
  const events = [...state.events, event];

  switch (event.type) {
    case "run_started":
      return {
        ...createInitialChatRunState(),
        status: "running",
        events,
      };

    case "model_request_started":
      return {
        ...state,
        status: "running",
        events,
      };

    case "assistant_text_delta":
      return {
        ...state,
        status: "running",
        events,
        pendingAssistantMessage: state.pendingAssistantMessage
          ? {
              ...state.pendingAssistantMessage,
              content: `${state.pendingAssistantMessage.content}${event.delta}`,
            }
          : createPendingAssistant(event.delta, event),
      };

    case "tool_call_requested":
      return {
        ...state,
        status: "running",
        events,
        toolCalls: upsertToolCall(state.toolCalls, event.toolCall),
      };

    case "tool_call_awaiting_approval":
      return {
        ...state,
        status: "awaiting-approval",
        events,
        toolCalls: upsertToolCall(state.toolCalls, event.toolCall),
      };

    case "tool_execution_started":
      return {
        ...state,
        status: "running",
        events,
        toolCalls: upsertToolCall(state.toolCalls, event.toolCall),
      };

    case "tool_result_returned":
      return {
        ...state,
        status: "running",
        events,
        toolCalls: upsertToolCall(state.toolCalls, event.toolCall, {
          result: event.result,
        }),
      };

    case "tool_call_denied":
      return {
        ...state,
        status: "running",
        events,
        toolCalls: upsertToolCall(state.toolCalls, event.toolCall, {
          denialReason: event.reason,
        }),
      };

    case "assistant_message_completed":
      return {
        ...state,
        events,
        pendingAssistantMessage: null,
        completedAssistantMessage: event.message,
      };

    case "run_completed":
      return {
        ...state,
        status: "completed",
        events,
      };

    case "run_failed":
      return {
        ...state,
        status: "failed",
        events,
        failure: event.message,
        pendingAssistantMessage: null,
      };

    case "run_retrying":
      return {
        ...state,
        status: "running",
        events,
        failure: null,
      };

    case "run_cancelled":
      return {
        ...state,
        status: "cancelled",
        events,
        failure: event.message,
        pendingAssistantMessage: null,
      };
  }
}

export function chatRunReducer(state: ChatRunState, action: ChatRunAction): ChatRunState {
  if (action.type === "reset") {
    return createInitialChatRunState();
  }

  return applyRunEvent(state, action.event);
}
