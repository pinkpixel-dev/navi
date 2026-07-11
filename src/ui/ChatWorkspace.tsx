import { FormEvent, KeyboardEvent, useState } from "react";
import { PanelRightOpen, Send, Square } from "lucide-react";
import type { Conversation } from "../core/conversation/types";
import type { ChatRunState } from "../core/chat-state/chatRunReducer";
import type { ProviderModel } from "../core/providers/types";
import type { SubmitShortcut } from "../core/settings/appSettings";

interface ChatWorkspaceProps {
  conversation: Conversation;
  isRunning: boolean;
  runState: ChatRunState;
  isCanvasOpen: boolean;
  availableModels: ProviderModel[];
  submitShortcut: SubmitShortcut;
  onCancelRun: () => void;
  onModelChange: (model: ProviderModel) => void;
  onToggleCanvas: () => void;
  onSend: (content: string) => void;
}

export function ChatWorkspace({
  conversation,
  isRunning,
  runState,
  isCanvasOpen,
  availableModels,
  submitShortcut,
  onCancelRun,
  onModelChange,
  onToggleCanvas,
  onSend,
}: ChatWorkspaceProps) {
  const [draft, setDraft] = useState("");

  const submitDraft = () => {
    if (isRunning) {
      onCancelRun();
      return;
    }

    onSend(draft);
    setDraft("");
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitDraft();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") {
      return;
    }

    const shouldSubmit = submitShortcut === "enter" ? !event.shiftKey : event.shiftKey;
    if (!shouldSubmit) {
      return;
    }

    event.preventDefault();
    submitDraft();
  };

  return (
    <section className="chat-workspace">
      <header className="workspace-header">
        <div>
          <h1>{conversation.title}</h1>
          <div className="workspace-meta">
            <span>{conversation.projectName}</span>
            <select
              aria-label="Active model"
              value={conversation.model}
              disabled={!availableModels.length}
              onChange={(event) => {
                const nextModel = availableModels.find((model) => model.id === event.target.value);
                if (nextModel) {
                  onModelChange(nextModel);
                }
              }}
            >
              {!availableModels.length ? <option value="">No providers</option> : null}
              {availableModels.map((model) => (
                <option key={`${model.provider}-${model.id}`} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {!isCanvasOpen ? (
          <div className="status-strip">
            <button className="header-icon-button" type="button" aria-label="Open canvas" onClick={onToggleCanvas}>
              <PanelRightOpen size={15} />
            </button>
          </div>
        ) : null}
      </header>

      <div className="message-list">
        {!conversation.messages.length && !isRunning ? (
          <div className="empty-chat" role="status">
            <h2>Ready when you are.</h2>
            <p>{availableModels.length ? "Start a new conversation." : "Add a provider in Settings to start chatting."}</p>
          </div>
        ) : (
          conversation.messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <div className="message-role">{message.role}</div>
              <p>{message.content}</p>
              {message.toolCalls?.length ? (
                <div className="tool-stack">
                  {message.toolCalls.map((toolCall) => (
                    <div className="tool-card" key={toolCall.id}>
                      <strong>{toolCall.toolName}</strong>
                      <span>{toolCall.serverName}</span>
                      <small>
                        {toolCall.risk} / {toolCall.status} / {toolCall.durationMs ?? 0}ms
                      </small>
                      <p>{toolCall.summary}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          ))
        )}
        {isRunning ? (
          <article className="message assistant pending">
            <div className="message-role">assistant</div>
            <p>{runState.pendingAssistantMessage?.content || "Thinking..."}</p>
            {runState.toolCalls.length ? (
              <div className="tool-stack">
                {runState.toolCalls.map((toolCall) => (
                  <div className="tool-card" key={toolCall.id}>
                    <strong>{toolCall.toolName}</strong>
                    <span>{toolCall.serverName}</span>
                    <small>
                      {toolCall.risk} / {toolCall.status}
                    </small>
                    <p>{toolCall.result ?? toolCall.denialReason ?? toolCall.summary}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </article>
        ) : null}
      </div>

      <form className="composer" onSubmit={handleSubmit}>
        <textarea
          aria-label="Message"
          placeholder="Ask anything..."
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="send-button" type="submit" disabled={!isRunning && !draft.trim()}>
          {isRunning ? <Square size={17} /> : <Send size={17} />}
        </button>
      </form>
    </section>
  );
}
