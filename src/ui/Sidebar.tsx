import { KeyboardEvent, PointerEvent, useState } from "react";
import {
  FolderPlus,
  MessageSquarePlus,
  Pin,
  Search,
  Settings,
  SlidersHorizontal,
} from "lucide-react";
import type { Conversation } from "../core/conversation/types";
import { formatRelativeTime } from "../core/conversation/formatRelativeTime";
import { defaultProjectName, type ProjectSettings } from "../core/projects/projectSettings";
import { ChatActionsMenu } from "./ChatActionsMenu";
import { ProjectIconMark } from "./projectVisuals";

interface SidebarProps {
  activeConversationId: string;
  activeProjectName: string | null;
  conversations: Conversation[];
  projects: ProjectSettings[];
  onNewChat: (projectName?: string) => void;
  onCreateProject: (name: string) => void;
  onSelectProject: (projectName: string | null) => void;
  onEditProject: (project: ProjectSettings) => void;
  onOpenSettings: () => void;
  onSelectConversation: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
  onTogglePin: (conversationId: string) => void;
  onToggleArchive: (conversationId: string) => void;
  onRenameConversation: (conversationId: string, title: string) => void;
  onMoveConversationToProject: (conversationId: string, projectName: string) => void;
  onResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
}

type RowEditMode = "rename" | null;

interface ChatRowProps {
  conversation: Conversation;
  isActive: boolean;
  editMode: RowEditMode;
  editDraft: string;
  projectOptions: ProjectSettings[];
  onSelect: () => void;
  onStartEdit: () => void;
  onEditDraftChange: (value: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
  onMoveToProject: (projectName: string) => void;
}

function ChatRow({
  conversation,
  isActive,
  editMode,
  editDraft,
  projectOptions,
  onSelect,
  onStartEdit,
  onEditDraftChange,
  onCommitEdit,
  onCancelEdit,
  onTogglePin,
  onToggleArchive,
  onDelete,
  onMoveToProject,
}: ChatRowProps) {
  const handleEditKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onCommitEdit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancelEdit();
    }
  };

  return (
    <div className={isActive ? "chat-row active" : "chat-row"}>
      <button className="chat-row-select" type="button" onClick={onSelect}>
        {conversation.isPinned ? <Pin size={13} className="chat-row-pin-mark" /> : null}
        {editMode ? (
          <input
            className="chat-row-rename-input"
            autoFocus
            aria-label="Rename chat"
            value={editDraft}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onEditDraftChange(event.target.value)}
            onKeyDown={handleEditKeyDown}
            onBlur={onCommitEdit}
          />
        ) : (
          <>
            <span>{conversation.title}</span>
            <small>{formatRelativeTime(conversation.updatedAt)}</small>
          </>
        )}
      </button>
      <ChatActionsMenu
        conversation={conversation}
        projectOptions={projectOptions}
        onStartEdit={onStartEdit}
        onTogglePin={onTogglePin}
        onToggleArchive={onToggleArchive}
        onDelete={onDelete}
        onMoveToProject={onMoveToProject}
      />
    </div>
  );
}

export function Sidebar({
  activeConversationId,
  activeProjectName,
  conversations,
  projects,
  onNewChat,
  onCreateProject,
  onSelectProject,
  onEditProject,
  onOpenSettings,
  onSelectConversation,
  onDeleteConversation,
  onTogglePin,
  onToggleArchive,
  onRenameConversation,
  onMoveConversationToProject,
  onResizeStart,
}: SidebarProps) {
  const [searchText, setSearchText] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<RowEditMode>(null);
  const [editDraft, setEditDraft] = useState("");

  const startEdit = (conversation: Conversation) => {
    setEditingId(conversation.id);
    setEditMode("rename");
    setEditDraft(conversation.title);
  };

  const commitEdit = () => {
    if (editingId && editMode === "rename") {
      onRenameConversation(editingId, editDraft);
    }
    setEditingId(null);
    setEditMode(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditMode(null);
  };

  const matchesSearch = (conversation: Conversation) => {
    const query = searchText.trim().toLowerCase();
    if (!query) {
      return true;
    }
    if (conversation.title.toLowerCase().includes(query)) {
      return true;
    }
    return conversation.messages.some((message) => message.content.toLowerCase().includes(query));
  };

  const filtered = conversations.filter(matchesSearch);
  const archived = filtered.filter(
    (conversation) => conversation.isArchived && conversation.projectName === defaultProjectName,
  );
  const pinned = filtered.filter((conversation) => !conversation.isArchived && conversation.isPinned);
  const recent = filtered.filter(
    (conversation) =>
      !conversation.isArchived && !conversation.isPinned && conversation.projectName === defaultProjectName,
  );

  const handleCreateProject = () => {
    const baseName = "New project";
    const projectNames = new Set(projects.map((project) => project.name.toLowerCase()));
    let nextName = baseName;
    let suffix = 2;

    while (projectNames.has(nextName.toLowerCase())) {
      nextName = `${baseName} ${suffix}`;
      suffix += 1;
    }

    onCreateProject(nextName);
  };

  const renderRow = (conversation: Conversation) => (
    <ChatRow
      key={conversation.id}
      conversation={conversation}
      isActive={conversation.id === activeConversationId}
      editMode={conversation.id === editingId ? editMode : null}
      editDraft={editDraft}
      projectOptions={projects}
      onSelect={() => onSelectConversation(conversation.id)}
      onStartEdit={() => startEdit(conversation)}
      onEditDraftChange={setEditDraft}
      onCommitEdit={commitEdit}
      onCancelEdit={cancelEdit}
      onTogglePin={() => onTogglePin(conversation.id)}
      onToggleArchive={() => onToggleArchive(conversation.id)}
      onDelete={() => onDeleteConversation(conversation.id)}
      onMoveToProject={(projectName) => onMoveConversationToProject(conversation.id, projectName)}
    />
  );

  return (
    <aside className="sidebar">
      <div className="brand">
        <img className="navi-icon-accent" src="/icon.png" alt="" />
        <div>
          <strong>Navi</strong>
        </div>
      </div>

      <button
        className="primary-button"
        type="button"
        onClick={() => onNewChat()}
      >
        <MessageSquarePlus size={16} />
        New chat
      </button>

      <label className="search-box">
        <Search size={15} />
        <input
          placeholder="Search chats and messages"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
      </label>

      {pinned.length ? (
        <section className="nav-section">
          <h2>Pinned</h2>
          {pinned.map(renderRow)}
        </section>
      ) : null}

      <section className="nav-section projects-section">
        <div className="nav-section-header">
          <h2>Projects</h2>
          <button type="button" aria-label="Create project" onClick={handleCreateProject}>
            <FolderPlus size={14} />
          </button>
        </div>
        {projects.map((project) => (
          <div className={project.name === activeProjectName ? "project-row active" : "project-row"} key={project.id}>
            <button type="button" onClick={() => onSelectProject(project.name)}>
              <ProjectIconMark icon={project.icon} color={project.color} />
              <span>{project.name}</span>
            </button>
            <button type="button" aria-label={`Edit ${project.name}`} onClick={() => onEditProject(project)}>
              <SlidersHorizontal size={13} />
            </button>
          </div>
        ))}
      </section>

      <section className="nav-section grow">
        <h2>Chats</h2>
        {recent.length ? (
          recent.map(renderRow)
        ) : filtered.length === 0 && searchText.trim() ? (
          <p className="chat-row-empty">No chats match &ldquo;{searchText.trim()}&rdquo;.</p>
        ) : null}
        {archived.length ? (
          <>
            <button className="archived-toggle" type="button" onClick={() => setShowArchived((current) => !current)}>
              <h2>
                Archived ({archived.length}) {showArchived ? "▾" : "▸"}
              </h2>
            </button>
            {showArchived ? archived.map(renderRow) : null}
          </>
        ) : null}
      </section>

      <button className="ghost-button" type="button" onClick={onOpenSettings}>
        <Settings size={16} />
        Settings
      </button>
      <div className="sidebar-resizer" role="separator" aria-label="Resize sidebar" onPointerDown={onResizeStart} />
    </aside>
  );
}
