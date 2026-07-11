import type { ChatMessage, Conversation } from "../conversation/types";
import type { ProviderCompleteInput, ProviderResponse } from "../providers/types";
import { toolRegistry } from "../tools/toolRegistry";
import type { ToolDefinition } from "../tools/types";
import type { AgentRunResult, ApprovalPolicy, RunEvent, RunLimits, RunRetryPolicy } from "./types";

type ProviderComplete = (input: ProviderCompleteInput) => Promise<ProviderResponse>;

interface RunAgentLoopInput {
  conversation: Conversation;
  input: string;
  approvalPolicy?: ApprovalPolicy;
  limits?: RunLimits;
  retry?: RunRetryPolicy;
  providerComplete: ProviderComplete;
  signal?: AbortSignal;
  timeoutMs?: number;
  onEvent?: (event: RunEvent) => void;
}

const defaultLimits: RunLimits = {
  maxModelSteps: 8,
  maxToolCalls: 16,
};

const seedMessageIds = new Set(["message-welcome", "message-plan", "message-mcp"]);
const internalAssistantMessages = new Set([
  "The provider request failed.",
  "The run was cancelled.",
  "The run timed out before the provider responded.",
  "The run stopped because the model step limit was reached.",
]);

function createEventId(): string {
  return crypto.randomUUID();
}

function createTimestamp(): string {
  return new Date().toISOString();
}

function createFallbackMessage(content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    createdAt: createTimestamp(),
    content,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function createCancelledMessage(): ChatMessage {
  return createFallbackMessage("The run was cancelled.");
}

function createTimeoutMessage(): ChatMessage {
  return createFallbackMessage("The run timed out before the provider responded.");
}

function createUserMessage(content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    createdAt: createTimestamp(),
    content,
  };
}

function isProviderContextMessage(message: ChatMessage): boolean {
  if (seedMessageIds.has(message.id)) {
    return false;
  }

  if (message.role === "assistant" && internalAssistantMessages.has(message.content)) {
    return false;
  }

  return true;
}

function createProviderMessages(conversation: Conversation, input: string): ChatMessage[] {
  return [...conversation.messages.filter(isProviderContextMessage), createUserMessage(input)];
}

async function runWithControls<T>(operation: () => Promise<T>, signal?: AbortSignal, timeoutMs?: number): Promise<T> {
  if (signal?.aborted) {
    throw new DOMException("The run was cancelled.", "AbortError");
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      signal?.removeEventListener("abort", abort);
    };

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };

    const abort = () => {
      settle(() => reject(new DOMException("The run was cancelled.", "AbortError")));
    };

    signal?.addEventListener("abort", abort, { once: true });

    if (timeoutMs !== undefined) {
      timeoutId = setTimeout(() => {
        settle(() => reject(new Error("Run timed out.")));
      }, timeoutMs);
    }

    operation().then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    );
  });
}

export async function runAgentLoop({
  conversation,
  input,
  approvalPolicy = "allow-all",
  limits = defaultLimits,
  retry = { maxAttempts: 1 },
  providerComplete,
  signal,
  timeoutMs,
  onEvent,
}: RunAgentLoopInput): Promise<AgentRunResult> {
  const runId = crypto.randomUUID();
  const events: RunEvent[] = [];
  const record = (event: RunEvent) => {
    events.push(event);
    onEvent?.(event);
  };

  record({
    id: createEventId(),
    type: "run_started",
    timestamp: createTimestamp(),
  });
  record({
    id: createEventId(),
    type: "model_request_started",
    timestamp: createTimestamp(),
    step: 1,
  });

  if (limits.maxModelSteps < 1) {
    record({
      id: createEventId(),
      type: "run_failed",
      timestamp: createTimestamp(),
      reason: "model_step_limit_reached",
      message: "The run stopped before the first model request because the model step limit was reached.",
    });

    return {
      id: runId,
      status: "failed",
      message: createFallbackMessage("The run stopped because the model step limit was reached."),
      events,
    };
  }

  let response;
  let streamedAnyDelta = false;
  const maxAttempts = Math.max(1, retry.maxAttempts);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      response = await runWithControls(
        () =>
          providerComplete({
            messages: createProviderMessages(conversation, input),
            signal,
            onDelta: (delta) => {
              streamedAnyDelta = true;
              record({
                id: createEventId(),
                type: "assistant_text_delta",
                timestamp: createTimestamp(),
                delta,
              });
            },
          }),
        signal,
        timeoutMs,
      );
      break;
    } catch (error) {
      if (isAbortError(error)) {
        record({
          id: createEventId(),
          type: "run_cancelled",
          timestamp: createTimestamp(),
          reason: "user_cancelled",
          message: "The run was cancelled.",
        });

        return {
          id: runId,
          status: "cancelled",
          message: createCancelledMessage(),
          events,
        };
      }

      if (error instanceof Error && error.message === "Run timed out.") {
        record({
          id: createEventId(),
          type: "run_failed",
          timestamp: createTimestamp(),
          reason: "timeout",
          message: "The run timed out before the provider responded.",
        });

        return {
          id: runId,
          status: "failed",
          message: createTimeoutMessage(),
          events,
        };
      }

      if (attempt < maxAttempts) {
        record({
          id: createEventId(),
          type: "run_retrying",
          timestamp: createTimestamp(),
          attempt: attempt + 1,
          maxAttempts,
          reason: "provider_error",
          message: error instanceof Error ? error.message : "The provider request failed.",
        });
        continue;
      }

      record({
        id: createEventId(),
        type: "run_failed",
        timestamp: createTimestamp(),
        reason: "provider_error",
        message: error instanceof Error ? error.message : "The provider request failed.",
      });

      return {
        id: runId,
        status: "failed",
        message: createFallbackMessage("The provider request failed."),
        events,
      };
    }
  }

  if (!response) {
    record({
      id: createEventId(),
      type: "run_failed",
      timestamp: createTimestamp(),
      reason: "provider_error",
      message: "The provider request failed.",
    });

    return {
      id: runId,
      status: "failed",
      message: createFallbackMessage("The provider request failed."),
      events,
    };
  }

  if (response.toolCalls.length > limits.maxToolCalls) {
    record({
      id: createEventId(),
      type: "run_failed",
      timestamp: createTimestamp(),
      reason: "tool_call_limit_reached",
      message: "The run stopped because the tool call limit was reached.",
    });

    return {
      id: runId,
      status: "failed",
      message: createFallbackMessage("The run stopped because the tool call limit was reached."),
      events,
    };
  }

  if (response.toolCalls.length === 0) {
    if (!streamedAnyDelta) {
      record({
        id: createEventId(),
        type: "assistant_text_delta",
        timestamp: createTimestamp(),
        delta: response.message.content,
      });
    }
    record({
      id: createEventId(),
      type: "assistant_message_completed",
      timestamp: createTimestamp(),
      message: response.message,
    });
    record({
      id: createEventId(),
      type: "run_completed",
      timestamp: createTimestamp(),
    });

    return {
      id: runId,
      status: "completed",
      message: response.message,
      events,
    };
  }

  const toolNames = response.toolCalls.map((tool) => tool.toolName);
  const knownTools = toolRegistry.filter((tool: ToolDefinition) => toolNames.includes(tool.name));
  const deniedToolCall = response.toolCalls.find(
    (toolCall) => approvalPolicy === "deny-writes" && toolCall.risk === "write",
  );

  for (const toolCall of response.toolCalls) {
    record({
      id: createEventId(),
      type: "tool_call_requested",
      timestamp: createTimestamp(),
      toolCall,
    });

    if (toolCall.risk === "write" || toolCall.risk === "destructive") {
      record({
        id: createEventId(),
        type: "tool_call_awaiting_approval",
        timestamp: createTimestamp(),
        toolCall,
      });
    }

    if (deniedToolCall?.id === toolCall.id) {
      const deniedMessage: ChatMessage = {
        ...response.message,
        content: "The requested write tool was denied by the current approval policy.",
        toolCalls: response.toolCalls.map((currentToolCall) =>
          currentToolCall.id === toolCall.id ? { ...currentToolCall, status: "failed" } : currentToolCall,
        ),
      };

      record({
        id: createEventId(),
        type: "tool_call_denied",
        timestamp: createTimestamp(),
        toolCall: { ...toolCall, status: "failed" },
        reason: "Approval policy denies write tools.",
      });
      record({
        id: createEventId(),
        type: "assistant_message_completed",
        timestamp: createTimestamp(),
        message: deniedMessage,
      });
      record({
        id: createEventId(),
        type: "run_completed",
        timestamp: createTimestamp(),
      });

      return {
        id: runId,
        status: "completed",
        message: deniedMessage,
        events,
      };
    }

    record({
      id: createEventId(),
      type: "tool_execution_started",
      timestamp: createTimestamp(),
      toolCall,
    });
    record({
      id: createEventId(),
      type: "tool_result_returned",
      timestamp: createTimestamp(),
      toolCall: { ...toolCall, status: "completed" },
      result: toolCall.summary,
    });
  }

  const toolsUsedSuffix = `\n\nTools used: ${knownTools.map((tool) => tool.label).join(", ")}.`;
  const message: ChatMessage = {
    ...response.message,
    content: `${response.message.content}${toolsUsedSuffix}`,
    toolCalls: response.toolCalls.map((toolCall) => ({ ...toolCall, status: "completed" })),
  };

  record({
    id: createEventId(),
    type: "assistant_text_delta",
    timestamp: createTimestamp(),
    delta: streamedAnyDelta ? toolsUsedSuffix : message.content,
  });
  record({
    id: createEventId(),
    type: "assistant_message_completed",
    timestamp: createTimestamp(),
    message,
  });
  record({
    id: createEventId(),
    type: "run_completed",
    timestamp: createTimestamp(),
  });

  return {
    id: runId,
    status: "completed",
    message,
    events,
  };
}
