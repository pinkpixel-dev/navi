import type { ChatMessage, ToolCallEvent } from "../conversation/types";

export type RunStatus = "idle" | "running" | "awaiting-approval" | "completed" | "failed" | "cancelled";

export type RunFailureReason = "tool_call_limit_reached" | "model_step_limit_reached" | "provider_error" | "timeout";

export type RunCancellationReason = "user_cancelled";

export type ApprovalPolicy = "allow-all" | "deny-writes";

export interface RunLimits {
  maxModelSteps: number;
  maxToolCalls: number;
}

export interface RunRetryPolicy {
  maxAttempts: number;
}

export type RunEvent =
  | {
      id: string;
      type: "run_started";
      timestamp: string;
    }
  | {
      id: string;
      type: "model_request_started";
      timestamp: string;
      step: number;
    }
  | {
      id: string;
      type: "assistant_text_delta";
      timestamp: string;
      delta: string;
    }
  | {
      id: string;
      type: "tool_call_requested";
      timestamp: string;
      toolCall: ToolCallEvent;
    }
  | {
      id: string;
      type: "tool_call_awaiting_approval";
      timestamp: string;
      toolCall: ToolCallEvent;
    }
  | {
      id: string;
      type: "tool_call_denied";
      timestamp: string;
      toolCall: ToolCallEvent;
      reason: string;
    }
  | {
      id: string;
      type: "tool_execution_started";
      timestamp: string;
      toolCall: ToolCallEvent;
    }
  | {
      id: string;
      type: "tool_result_returned";
      timestamp: string;
      toolCall: ToolCallEvent;
      result: string;
    }
  | {
      id: string;
      type: "assistant_message_completed";
      timestamp: string;
      message: ChatMessage;
    }
  | {
      id: string;
      type: "run_completed";
      timestamp: string;
    }
  | {
      id: string;
      type: "run_failed";
      timestamp: string;
      reason: RunFailureReason;
      message: string;
    }
  | {
      id: string;
      type: "run_retrying";
      timestamp: string;
      attempt: number;
      maxAttempts: number;
      reason: RunFailureReason;
      message: string;
    }
  | {
      id: string;
      type: "run_cancelled";
      timestamp: string;
      reason: RunCancellationReason;
      message: string;
    };

export interface AgentRunResult {
  id: string;
  status: Exclude<RunStatus, "idle" | "running" | "awaiting-approval">;
  message: ChatMessage;
  events: RunEvent[];
}
