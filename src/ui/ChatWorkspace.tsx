import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  FileText,
  MessageSquarePlus,
  Paperclip,
  PanelRightOpen,
  Pencil,
  Send,
  SlidersHorizontal,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { Conversation, MessageAttachment, ToolCallEvent } from "../core/conversation/types";
import type { ChatRunState } from "../core/chat-state/chatRunReducer";
import type { ApprovalDecision } from "../core/agent-loop/types";
import type { ProviderModel } from "../core/providers/types";
import type { SubmitShortcut } from "../core/settings/appSettings";
import { defaultProjectName, type ProjectSettings } from "../core/projects/projectSettings";
import { ChatActionsMenu } from "./ChatActionsMenu";
import { ProjectMoveMenu } from "./ProjectMoveMenu";
import { ProjectIconMark } from "./projectVisuals";
import { MessageContent } from "./MessageContent";

interface ChatWorkspaceProps {
  conversation: Conversation;
  isRunning: boolean;
  runState: ChatRunState;
  isCanvasOpen: boolean;
  availableModels: ProviderModel[];
  submitShortcut: SubmitShortcut;
  projects: ProjectSettings[];
  projectView: { project: ProjectSettings; projects: ProjectSettings[]; conversations: Conversation[] } | null;
  userDisplayName?: string;
  userAvatarSrc: string;
  assistantAvatarSrc: string;
  userAvatarIsDefault: boolean;
  assistantAvatarIsDefault: boolean;
  pendingApprovalToolCall: ToolCallEvent | null;
  onApprovalDecision: (decision: ApprovalDecision) => void;
  onCancelRun: () => void;
  onModelChange: (model: ProviderModel) => void;
  onNewChatInProject: (projectName: string) => void;
  onEditProject: (project: ProjectSettings) => void;
  onSelectConversation: (conversationId: string) => void;
  onMoveConversationToProject: (conversationId: string, projectName: string) => void;
  onRenameConversation: (conversationId: string, title: string) => void;
  onTogglePin: (conversationId: string) => void;
  onToggleArchive: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
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
  projects,
  projectView,
  userDisplayName,
  userAvatarSrc,
  assistantAvatarSrc,
  userAvatarIsDefault,
  assistantAvatarIsDefault,
  pendingApprovalToolCall,
  onApprovalDecision,
  onCancelRun,
  onModelChange,
  onNewChatInProject,
  onEditProject,
  onSelectConversation,
  onMoveConversationToProject,
  onRenameConversation,
  onTogglePin,
  onToggleArchive,
  onDeleteConversation,
  onToggleCanvas,
  onSend,
}: ChatWorkspaceProps) {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isRenamingActiveChat, setIsRenamingActiveChat] = useState(false);
  const [activeChatTitleDraft, setActiveChatTitleDraft] = useState(conversation.title);
  const [editingProjectChatId, setEditingProjectChatId] = useState<string | null>(null);
  const [projectChatTitleDraft, setProjectChatTitleDraft] = useState("");
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
    setIsRenamingActiveChat(false);
    setActiveChatTitleDraft(conversation.title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  const effectiveProvider = providerNames.includes(selectedProvider) ? selectedProvider : providerNames[0] ?? "";
  const modelsForProvider = useMemo(
    () => availableModels.filter((model) => model.provider === effectiveProvider),
    [availableModels, effectiveProvider],
  );
  const emptyChatHeading = userDisplayName?.trim()
    ? `Ready when you are, ${userDisplayName.trim()}.`
    : "Ready when you are.";

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

  const isDefaultAvatarFor = (role: string): boolean => {
    if (role === "user") {
      return userAvatarIsDefault;
    }
    if (role === "assistant") {
      return assistantAvatarIsDefault;
    }
    return false;
  };

  const renderRoleHeader = (role: string) => {
    const avatar = avatarFor(role);
    return avatar ? (
      <div className="message-role">
        <img
          className={isDefaultAvatarFor(role) ? "message-avatar default-avatar-accent" : "message-avatar"}
          src={avatar}
          alt={role}
        />
      </div>
    ) : (
      <div className="message-role">{role}</div>
    );
  };

  const commitActiveChatRename = () => {
    if (isRenamingActiveChat) {
      onRenameConversation(conversation.id, activeChatTitleDraft);
    }
    setIsRenamingActiveChat(false);
  };

  const handleActiveChatRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitActiveChatRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setIsRenamingActiveChat(false);
    }
  };

  const startProjectChatRename = (conversation: Conversation) => {
    setEditingProjectChatId(conversation.id);
    setProjectChatTitleDraft(conversation.title);
  };

  const commitProjectChatRename = () => {
    if (editingProjectChatId) {
      onRenameConversation(editingProjectChatId, projectChatTitleDraft);
    }
    setEditingProjectChatId(null);
  };

  const handleProjectChatRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitProjectChatRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setEditingProjectChatId(null);
    }
  };

  return (
    <section className="chat-workspace">
      <header className="workspace-header">
        <div className="workspace-heading">
          {isRenamingActiveChat ? (
            <input
              className="workspace-title-input"
              autoFocus
              aria-label="Rename chat"
              value={activeChatTitleDraft}
              onBlur={commitActiveChatRename}
              onChange={(event) => setActiveChatTitleDraft(event.target.value)}
              onKeyDown={handleActiveChatRenameKeyDown}
            />
          ) : (
            <h1>{conversation.title}</h1>
          )}
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
        <div className="status-strip">
          {!projectView ? (
            <ChatActionsMenu
              className="workspace-chat-actions"
              conversation={conversation}
              projectOptions={projects}
              onStartEdit={() => {
                setActiveChatTitleDraft(conversation.title);
                setIsRenamingActiveChat(true);
              }}
              onTogglePin={() => onTogglePin(conversation.id)}
              onToggleArchive={() => onToggleArchive(conversation.id)}
              onDelete={() => onDeleteConversation(conversation.id)}
              onMoveToProject={(projectName) => onMoveConversationToProject(conversation.id, projectName)}
            />
          ) : null}
          {!isCanvasOpen ? (
            <button className="header-icon-button" type="button" aria-label="Open canvas" onClick={onToggleCanvas}>
              <PanelRightOpen size={15} />
            </button>
          ) : null}
        </div>
      </header>

      <div className="message-list">
        {projectView ? (
          <div className="project-home">
            <div className="project-home-header">
              <ProjectIconMark icon={projectView.project.icon} color={projectView.project.color} size={22} />
              <div>
                <h2>{projectView.project.name}</h2>
                <p>{projectView.conversations.length} chat{projectView.conversations.length === 1 ? "" : "s"}</p>
              </div>
              <div className="project-home-actions">
                <button
                  className="project-home-icon-button"
                  type="button"
                  aria-label={`Open ${projectView.project.name} settings`}
                  title="Project settings"
                  onClick={() => onEditProject(projectView.project)}
                >
                  <SlidersHorizontal size={15} />
                </button>
                <button type="button" onClick={() => onNewChatInProject(projectView.project.name)}>
                  <MessageSquarePlus size={15} />
                  New chat
                </button>
              </div>
            </div>
            <div className="project-chat-list">
              {projectView.conversations.length ? (
                projectView.conversations.map((projectConversation) => (
                  <div
                    className="project-chat-row"
                    key={projectConversation.id}
                  >
                    {editingProjectChatId === projectConversation.id ? (
                      <input
                        className="project-chat-rename-input"
                        autoFocus
                        aria-label="Rename project chat"
                        value={projectChatTitleDraft}
                        onChange={(event) => setProjectChatTitleDraft(event.target.value)}
                        onBlur={commitProjectChatRename}
                        onKeyDown={handleProjectChatRenameKeyDown}
                      />
                    ) : (
                      <button
                        className="project-chat-row-select"
                        type="button"
                        onClick={() => onSelectConversation(projectConversation.id)}
                      >
                        <span>{projectConversation.title}</span>
                        <small>{projectConversation.messages.at(-1)?.content.slice(0, 120) || "No messages yet."}</small>
                      </button>
                    )}
                    <div className="project-chat-row-actions">
                      <button
                        type="button"
                        aria-label={`Rename ${projectConversation.title}`}
                        onClick={() => startProjectChatRename(projectConversation)}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        aria-label={projectConversation.isArchived ? `Unarchive ${projectConversation.title}` : `Archive ${projectConversation.title}`}
                        onClick={() => onToggleArchive(projectConversation.id)}
                      >
                        {projectConversation.isArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${projectConversation.title}`}
                        onClick={() => onDeleteConversation(projectConversation.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${projectConversation.title} from ${projectView.project.name}`}
                        onClick={() => onMoveConversationToProject(projectConversation.id, defaultProjectName)}
                      >
                        <X size={13} />
                      </button>
                      <ProjectMoveMenu
                        chatTitle={projectConversation.title}
                        currentProjectName={projectView.project.name}
                        projects={projectView.projects}
                        onMove={(projectName) => onMoveConversationToProject(projectConversation.id, projectName)}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-chat" role="status">
                  <h2>No chats here yet.</h2>
                  <p>Start a new conversation in this project.</p>
                </div>
              )}
            </div>
          </div>
        ) : null}
        {!projectView && !conversation.messages.length && !isRunning ? (
          <div className="empty-chat" role="status">
            <h2>{emptyChatHeading}</h2>
            <p>{availableModels.length ? "Start a new conversation." : "Add a provider in Settings to start chatting."}</p>
          </div>
        ) : !projectView ? (
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
              <MessageContent content={message.content} role={message.role} />
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
        ) : null}
        {!projectView && isRunning ? (
          <article className="message assistant pending">
            {renderRoleHeader("assistant")}
            <MessageContent
              content={runState.pendingAssistantMessage?.content || "Thinking..."}
              role="assistant"
              isStreaming
            />
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

      {!projectView ? (
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
      ) : null}
    </section>
  );
}
