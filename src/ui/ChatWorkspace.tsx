import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Paperclip, PanelRightOpen, Send, Square, X } from "lucide-react";
import type { Conversation, MessageAttachment, ToolCallEvent } from "../core/conversation/types";
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
  userAvatarSrc: string;
  assistantAvatarSrc: string;
  pendingApprovalToolCall: ToolCallEvent | null;
  onApprovalDecision: (decision: ApprovalDecision) => void;
  onCancelRun: () => void;
  onModelChange: (model: ProviderModel) => void;
  onToggleCanvas: () => void;
  onSend: (content: string, attachments?: MessageAttachment[]) => void;
}

const imageMimeTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const textDocumentExtensions = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "csv",
  "tsv",
  "xml",
  "yaml",
  "yml",
  "toml",
  "log",
  "py",
  "js",
  "ts",
  "tsx",
  "jsx",
  "rs",
  "go",
  "java",
  "c",
  "cpp",
  "h",
  "css",
  "html",
  "sh",
  "sql",
]);
const maxAttachmentBytes = 10 * 1024 * 1024;

function isSupportedTextDocument(file: File): boolean {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return file.type.startsWith("text/") || textDocumentExtensions.has(extension);
}

function readFileAsAttachment(file: File): Promise<MessageAttachment> {
  return new Promise((resolve, reject) => {
    const isImage = imageMimeTypes.has(file.type);
    if (!isImage && !isSupportedTextDocument(file)) {
      reject(new Error(`${file.name} is not a supported attachment yet. Use images or text-based documents.`));
      return;
    }

    const reader = new FileReader();

    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      if (isImage) {
        const dataUri = String(reader.result ?? "");
        const base64 = dataUri.slice(dataUri.indexOf(",") + 1);
        resolve({
          id: crypto.randomUUID(),
          kind: "image",
          name: file.name,
          mimeType: file.type,
          data: base64,
        });
      } else {
        resolve({
          id: crypto.randomUUID(),
          kind: "text",
          name: file.name,
          mimeType: file.type || "text/plain",
          data: String(reader.result ?? ""),
        });
      }
    };

    if (isImage) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  });
}

function AttachmentChip({ attachment, onRemove }: { attachment: MessageAttachment; onRemove?: () => void }) {
  return (
    <span className="attachment-chip">
      {attachment.kind === "image" ? (
        <img src={`data:${attachment.mimeType};base64,${attachment.data}`} alt={attachment.name} />
      ) : (
        <FileText size={13} />
      )}
      <span className="attachment-name">{attachment.name}</span>
      {onRemove ? (
        <button type="button" aria-label={`Remove ${attachment.name}`} onClick={onRemove}>
          <X size={12} />
        </button>
      ) : null}
    </span>
  );
}

export function ChatWorkspace({
  conversation,
  isRunning,
  runState,
  isCanvasOpen,
  availableModels,
  submitShortcut,
  userAvatarSrc,
  assistantAvatarSrc,
  pendingApprovalToolCall,
  onApprovalDecision,
  onCancelRun,
  onModelChange,
  onToggleCanvas,
  onSend,
}: ChatWorkspaceProps) {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const handleAttachFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    setAttachmentError(null);

    for (const file of files) {
      if (file.size > maxAttachmentBytes) {
        setAttachmentError(`${file.name} is larger than 10MB.`);
        continue;
      }
      try {
        const attachment = await readFileAsAttachment(file);
        setAttachments((current) => [...current, attachment]);
      } catch (error) {
        setAttachmentError(error instanceof Error ? error.message : `Could not read ${file.name}.`);
      }
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  };

  const submitDraft = () => {
    if (isRunning) {
      onCancelRun();
      return;
    }

    onSend(draft, attachments.length ? attachments : undefined);
    setDraft("");
    setAttachments([]);
    setAttachmentError(null);
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

  const avatarFor = (role: string): string | null => {
    if (role === "user") {
      return userAvatarSrc;
    }
    if (role === "assistant") {
      return assistantAvatarSrc;
    }
    return null;
  };

  const renderRoleHeader = (role: string) => {
    const avatar = avatarFor(role);
    return avatar ? (
      <div className="message-role">
        <img className="message-avatar" src={avatar} alt={role} />
      </div>
    ) : (
      <div className="message-role">{role}</div>
    );
  };

  return (
    <section className="chat-workspace">
      <header className="workspace-header">
        <div className="workspace-heading">
          <h1>{conversation.title}</h1>
          <div className="workspace-meta">
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
              {renderRoleHeader(message.role)}
              {message.attachments?.length ? (
                <div className="attachment-list">
                  {message.attachments.map((attachment) => (
                    <AttachmentChip key={attachment.id} attachment={attachment} />
                  ))}
                </div>
              ) : null}
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
            {renderRoleHeader("assistant")}
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
        {attachments.length || attachmentError ? (
          <div className="composer-attachments">
            {attachments.map((attachment) => (
              <AttachmentChip
                key={attachment.id}
                attachment={attachment}
                onRemove={() => removeAttachment(attachment.id)}
              />
            ))}
            {attachmentError ? <span className="attachment-error">{attachmentError}</span> : null}
          </div>
        ) : null}
        <div className="composer-row">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={handleAttachFiles}
          />
          <button
            className="attach-button"
            type="button"
            aria-label="Attach files"
            title="Attach images or documents"
            disabled={isRunning}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip size={17} />
          </button>
          <textarea
            aria-label="Message"
            placeholder="Ask anything..."
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="send-button"
            type="submit"
            disabled={!isRunning && !draft.trim() && !attachments.length}
          >
            {isRunning ? <Square size={17} /> : <Send size={17} />}
          </button>
        </div>
      </form>
    </section>
  );
}
