import type { ChatMessage } from "../conversation/types";
import type { AgentRunResult, RunEvent } from "./types";

export const invalidRichResponseContent =
  "The provider did not return a complete Rich Response. Try again, or turn off Rich Responses in Settings.";

interface InvalidRichResponseInput {
  runId: string;
  transcript: ChatMessage[];
  events: RunEvent[];
  record: (event: RunEvent) => void;
  createEventId: () => string;
  createTimestamp: () => string;
  createMessage: (content: string) => ChatMessage;
}

export function failInvalidRichResponse({
  runId,
  transcript,
  events,
  record,
  createEventId,
  createTimestamp,
  createMessage,
}: InvalidRichResponseInput): AgentRunResult {
  const message = createMessage(invalidRichResponseContent);
  record({
    id: createEventId(),
    type: "run_failed",
    timestamp: createTimestamp(),
    reason: "invalid_response_format",
    message: message.content,
  });

  return {
    id: runId,
    status: "failed",
    message,
    transcript,
    events,
  };
}
