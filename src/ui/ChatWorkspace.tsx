import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";
import { PanelRightOpen, Send, Square } from "lucide-react";
import type { Conversation, ToolCallEvent } from "../core/conversation/types";
import type { ChatRunState } from "../core/chat-state/chatRunReducer";
import type { ApprovalDecision } from "../core/agent-loop/types";
import type { ProviderModel } from "../core/providers/types";
import type { SubmitShortcut } from "../core/settings/appSettings";

interface ChatWorkspaceProps {
  conversation: Conversation;
  isRunning: boolean;
  runState: ChatRunState;
  isCanvasOpen: boolean;
  availableModels: ProviderModel[];
  submitShortcut: SubmitShortcut;
  pendingApprovalToolCall: ToolCallEvent | null;
  onApprovalDecision: (decision: ApprovalDecision) => void;
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
  pendingApprovalToolCall,
  onApprovalDecision,
  onCancelRun,
  onModelChange,
  onToggleCanvas,
  onSend,
}: ChatWorkspaceProps) {
  const [draft, setDraft] = useState("");
  const [selectedProvider, setSelectedProvider] = useState(
    () => availableModels.find((model) => model.id === conversation.model)?.provider ?? "",
  );

  const providerNames = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const model of availableModels) {
      if (!seen.has(model.provider)) {
        seen.add(model.provider);
        names.push(model.provider);
      }
    }
    return names;
  }, [availableModels]);

  useEffect(() => {
    const activeModelProvider = availableModels.find((model) => model.id === conversation.model)?.provider;
    if (activeModelProvider) {
      setSelectedProvider(activeModelProvider);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  const effectiveProvider = providerNames.includes(selectedProvider) ? selectedProvider : providerNames[0] ?? "";
  const modelsForProvider = useMemo(
    () => availableModels.filter((model) => model.provider === effectiveProvider),
    [availableModels, effectiveProvider],
  );

  const handleProviderChange = (providerName: string) => {
    setSelectedProvider(providerName);
    const firstModel = availableModels.find((model) => model.provider === providerName);
    if (firstModel) {
      onModelChange(firstModel);
    }
  };

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
              aria-label="Active provider"
              value={effectiveProvider}
              disabled={!providerNames.length}
              onChange={(event) => handleProviderChange(event.target.value)}
            >
              {!providerNames.length ? <option value="">No providers</option> : null}
              {providerNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select
              aria-label="Active model"
              value={conversation.model}
              disabled={!modelsForProvider.length}
              onChange={(event) => {
                const nextModel = modelsForProvider.find((model) => model.id === event.target.value);
                if (nextModel) {
                  onModelChange(nextModel);
                }
              }}
            >
              {!modelsForProvider.length ? <option value="">No models</option> : null}
              {modelsForProvider.map((model) => (
                <option key={model.id} value={model.id}>
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
            {pendingApprovalToolCall ? (
              <div className="approval-card" role="alert">
                <strong>{pendingApprovalToolCall.toolName}</strong>
                <span>
                  {pendingApprovalToolCall.serverName} · {pendingApprovalToolCall.risk}
                </span>
                <p>{pendingApprovalToolCall.summary}</p>
                {pendingApprovalToolCall.arguments ? <code>{pendingApprovalToolCall.arguments}</code> : null}
                <div className="approval-actions">
                  <button type="button" onClick={() => onApprovalDecision("allow-once")}>
                    Allow once
                  </button>
                  <button type="button" onClick={() => onApprovalDecision("allow-conversation")}>
                    Allow for this conversation
                  </button>
                  <button type="button" className="approval-deny" onClick={() => onApprovalDecision("deny")}>
                    Deny
                  </button>
                </div>
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
