import type { ChatMessage, Conversation, MessageAttachment, ToolCallEvent } from "../conversation/types";
import type { ProviderCompleteInput, ProviderResponse, ProviderToolSchema } from "../providers/types";
import { hasCompleteRichResponse } from "../rich-response/richResponse";
import { failInvalidRichResponse } from "./richResponseRun";
import { createProviderMessages, type UserProfileContext } from "./systemPrompt";
import type { AgentRunResult, ApprovalDecision, ApprovalPolicy, RunEvent, RunLimits, RunRetryPolicy } from "./types";

type ProviderComplete = (input: ProviderCompleteInput) => Promise<ProviderResponse>;
interface ToolExecutionResult {
  content: string;
  isError: boolean;
}
interface RunAgentLoopInput {
  conversation: Conversation;
  input: string;
  attachments?: MessageAttachment[];
  userInstructions?: string;
  userProfile?: UserProfileContext;
  projectInstructions?: string;
  richResponsesEnabled?: boolean;
  approvalPolicy?: ApprovalPolicy;
  limits?: RunLimits;
  retry?: RunRetryPolicy;
  providerComplete: ProviderComplete;
  tools?: ProviderToolSchema[];
  executeTool?: (toolCall: ToolCallEvent) => Promise<ToolExecutionResult>;
  requestApproval?: (toolCall: ToolCallEvent) => Promise<ApprovalDecision>;
  signal?: AbortSignal;
  timeoutMs?: number;
  onEvent?: (event: RunEvent) => void;
}

const defaultLimits: RunLimits = {
  maxModelSteps: 8,
  maxToolCalls: 16,
};

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

function createToolResultMessage(toolCallId: string, content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "tool",
    createdAt: createTimestamp(),
    content,
    toolCallId,
  };
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
  attachments,
  userInstructions,
  userProfile,
  projectInstructions,
  richResponsesEnabled,
  approvalPolicy = "allow-all",
  limits = defaultLimits,
  retry = { maxAttempts: 1 },
  providerComplete,
  tools,
  executeTool,
  requestApproval,
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
      transcript: [],
      events,
    };
  }

  const workingMessages = createProviderMessages(
    conversation,
    input,
    attachments,
    userInstructions,
    userProfile,
    projectInstructions,
    richResponsesEnabled,
  );
  const seedLength = workingMessages.length;
  const allToolCalls: ToolCallEvent[] = [];
  let totalToolCallCount = 0;
  const maxAttempts = Math.max(1, retry.maxAttempts);

  for (let step = 1; step <= limits.maxModelSteps; step += 1) {
    record({
      id: createEventId(),
      type: "model_request_started",
      timestamp: createTimestamp(),
      step,
    });

    let response: ProviderResponse | undefined;
    let streamedAnyDelta = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        response = await runWithControls(
          () =>
            providerComplete({
              messages: workingMessages,
              signal,
              tools,
              onDelta: (delta) => {
                streamedAnyDelta = true;
                if (richResponsesEnabled) {
                  return;
                }
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
            transcript: workingMessages.slice(seedLength),
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
            transcript: workingMessages.slice(seedLength),
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

        const failureReason = error instanceof Error ? error.message : "The provider request failed.";
        record({
          id: createEventId(),
          type: "run_failed",
          timestamp: createTimestamp(),
          reason: "provider_error",
          message: failureReason,
        });

        return {
          id: runId,
          status: "failed",
          message: createFallbackMessage(`The provider request failed: ${failureReason}`),
          transcript: workingMessages.slice(seedLength),
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
        transcript: workingMessages.slice(seedLength),
        events,
      };
    }

    totalToolCallCount += response.toolCalls.length;
    if (totalToolCallCount > limits.maxToolCalls) {
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
        transcript: workingMessages.slice(seedLength),
        events,
      };
    }

    if (response.toolCalls.length === 0) {
      if (richResponsesEnabled && !hasCompleteRichResponse(response.message.content)) {
        return failInvalidRichResponse({
          runId,
          transcript: workingMessages.slice(seedLength),
          events,
          record,
          createEventId,
          createTimestamp,
          createMessage: createFallbackMessage,
        });
      }

      if (!richResponsesEnabled && !streamedAnyDelta) {
        record({
          id: createEventId(),
          type: "assistant_text_delta",
          timestamp: createTimestamp(),
          delta: response.message.content,
        });
      }

      const finalMessage: ChatMessage = {
        ...response.message,
        toolCalls: allToolCalls.length ? allToolCalls : undefined,
      };

      record({
        id: createEventId(),
        type: "assistant_message_completed",
        timestamp: createTimestamp(),
        message: finalMessage,
      });
      record({
        id: createEventId(),
        type: "run_completed",
        timestamp: createTimestamp(),
      });

      return {
        id: runId,
        status: "completed",
        message: finalMessage,
        transcript: workingMessages.slice(seedLength),
        events,
      };
    }

    workingMessages.push(response.message);

    for (const toolCall of response.toolCalls) {
      record({
        id: createEventId(),
        type: "tool_call_requested",
        timestamp: createTimestamp(),
        toolCall,
      });

      const needsApproval = toolCall.risk === "write" || toolCall.risk === "destructive";
      if (needsApproval) {
        record({
          id: createEventId(),
          type: "tool_call_awaiting_approval",
          timestamp: createTimestamp(),
          toolCall,
        });
      }

      let decision: ApprovalDecision = "allow-once";
      if (needsApproval) {
        if (requestApproval) {
          decision = await requestApproval(toolCall);
        } else if (approvalPolicy === "deny-writes") {
          decision = "deny";
        }
      }

      if (decision === "deny") {
        const deniedToolCall: ToolCallEvent = {
          ...toolCall,
          status: "failed",
          result: "The user denied this tool call.",
        };

        record({
          id: createEventId(),
          type: "tool_call_denied",
          timestamp: createTimestamp(),
          toolCall: deniedToolCall,
          reason: requestApproval ? "Denied by the user." : "Approval policy denies write tools.",
        });

        // Static-policy fallback (no interactive approval wired up): reproduce the
        // original hard-stop behavior exactly instead of continuing the loop.
        if (!requestApproval) {
          const deniedMessage: ChatMessage = {
            ...response.message,
            content: "The requested write tool was denied by the current approval policy.",
            toolCalls: response.toolCalls.map((currentToolCall) =>
              currentToolCall.id === toolCall.id ? deniedToolCall : currentToolCall,
            ),
          };

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
            transcript: [],
            events,
          };
        }

        allToolCalls.push(deniedToolCall);
        workingMessages.push(createToolResultMessage(toolCall.id, "The user denied this tool call."));
        continue;
      }

      record({
        id: createEventId(),
        type: "tool_execution_started",
        timestamp: createTimestamp(),
        toolCall,
      });

      const executionResult: ToolExecutionResult = executeTool
        ? await executeTool(toolCall)
        : { content: toolCall.summary, isError: false };

      const completedToolCall: ToolCallEvent = {
        ...toolCall,
        status: executionResult.isError ? "failed" : "completed",
        result: executionResult.content,
      };
      allToolCalls.push(completedToolCall);

      record({
        id: createEventId(),
        type: "tool_result_returned",
        timestamp: createTimestamp(),
        toolCall: completedToolCall,
        result: executionResult.content,
      });

      workingMessages.push(createToolResultMessage(toolCall.id, executionResult.content));
    }
  }

  record({
    id: createEventId(),
    type: "run_failed",
    timestamp: createTimestamp(),
    reason: "model_step_limit_reached",
    message: "The run stopped because the model step limit was reached.",
  });

  return {
    id: runId,
    status: "failed",
    message: createFallbackMessage("The run stopped because the model step limit was reached."),
    transcript: workingMessages.slice(seedLength),
    events,
  };
}
