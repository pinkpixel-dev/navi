import { KeyboardEvent, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  FolderInput,
  MessageSquarePlus,
  Pencil,
  Pin,
  PinOff,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import type { Conversation } from "../core/conversation/types";
import { formatRelativeTime } from "../core/conversation/formatRelativeTime";

const allProjectsFilter = "__all__";

interface SidebarProps {
  activeConversationId: string;
  conversations: Conversation[];
  onNewChat: (projectName?: string) => void;
  onOpenSettings: () => void;
  onSelectConversation: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
  onTogglePin: (conversationId: string) => void;
  onToggleArchive: (conversationId: string) => void;
  onRenameConversation: (conversationId: string, title: string) => void;
  onSetConversationProject: (conversationId: string, projectName: string) => void;
}

type RowEditMode = "rename" | "project" | null;

interface ChatRowProps {
  conversation: Conversation;
  isActive: boolean;
  editMode: RowEditMode;
  editDraft: string;
  onSelect: () => void;
  onStartEdit: (mode: Exclude<RowEditMode, null>) => void;
  onEditDraftChange: (value: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
}

function ChatRow({
  conversation,
  isActive,
  editMode,
  editDraft,
  onSelect,
  onStartEdit,
  onEditDraftChange,
  onCommitEdit,
  onCancelEdit,
  onTogglePin,
  onToggleArchive,
  onDelete,
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
            aria-label={editMode === "rename" ? "Rename chat" : "Move chat to project"}
            placeholder={editMode === "project" ? "Project name" : undefined}
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
      <div className="chat-row-actions">
        <button
          type="button"
          aria-label={conversation.isPinned ? `Unpin ${conversation.title}` : `Pin ${conversation.title}`}
          onClick={(event) => {
            event.stopPropagation();
            onTogglePin();
          }}
        >
          {conversation.isPinned ? <PinOff size={13} /> : <Pin size={13} />}
        </button>
        <button
          type="button"
          aria-label={`Rename ${conversation.title}`}
          onClick={(event) => {
            event.stopPropagation();
            onStartEdit("rename");
          }}
        >
          <Pencil size={13} />
        </button>
        <button
          type="button"
          aria-label={`Move ${conversation.title} to a project`}
          onClick={(event) => {
            event.stopPropagation();
            onStartEdit("project");
          }}
        >
          <FolderInput size={13} />
        </button>
        <button
          type="button"
          aria-label={conversation.isArchived ? `Unarchive ${conversation.title}` : `Archive ${conversation.title}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleArchive();
          }}
        >
          {conversation.isArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
        </button>
        <button
          type="button"
          aria-label={`Delete ${conversation.title}`}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

export function Sidebar({
  activeConversationId,
  conversations,
  onNewChat,
  onOpenSettings,
  onSelectConversation,
  onDeleteConversation,
  onTogglePin,
  onToggleArchive,
  onRenameConversation,
  onSetConversationProject,
}: SidebarProps) {
  const [searchText, setSearchText] = useState("");
  const [projectFilter, setProjectFilter] = useState(allProjectsFilter);
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<RowEditMode>(null);
  const [editDraft, setEditDraft] = useState("");

  const projectNames = useMemo(() => {
    const names = new Set<string>();
    for (const conversation of conversations) {
      if (conversation.projectName) {
        names.add(conversation.projectName);
      }
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [conversations]);

  const startEdit = (conversation: Conversation, mode: Exclude<RowEditMode, null>) => {
    setEditingId(conversation.id);
    setEditMode(mode);
    setEditDraft(mode === "rename" ? conversation.title : conversation.projectName);
  };

  const commitEdit = () => {
    if (editingId && editMode === "rename") {
      onRenameConversation(editingId, editDraft);
    } else if (editingId && editMode === "project") {
      onSetConversationProject(editingId, editDraft);
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

  const matchesProject = (conversation: Conversation) =>
    projectFilter === allProjectsFilter || conversation.projectName === projectFilter;

  const filtered = conversations.filter((conversation) => matchesSearch(conversation) && matchesProject(conversation));
  const archived = filtered.filter((conversation) => conversation.isArchived);
  const pinned = filtered.filter((conversation) => !conversation.isArchived && conversation.isPinned);
  const recent = filtered.filter((conversation) => !conversation.isArchived && !conversation.isPinned);

  const renderRow = (conversation: Conversation) => (
    <ChatRow
      key={conversation.id}
      conversation={conversation}
      isActive={conversation.id === activeConversationId}
      editMode={conversation.id === editingId ? editMode : null}
      editDraft={editDraft}
      onSelect={() => onSelectConversation(conversation.id)}
      onStartEdit={(mode) => startEdit(conversation, mode)}
      onEditDraftChange={setEditDraft}
      onCommitEdit={commitEdit}
      onCancelEdit={cancelEdit}
      onTogglePin={() => onTogglePin(conversation.id)}
      onToggleArchive={() => onToggleArchive(conversation.id)}
      onDelete={() => onDeleteConversation(conversation.id)}
    />
  );

  return (
    <aside className="sidebar">
      <div className="brand">
        <img src="/icon.png" alt="" />
        <div>
          <strong>Navi</strong>
        </div>
      </div>

      <button
        className="primary-button"
        type="button"
        onClick={() => onNewChat(projectFilter === allProjectsFilter ? undefined : projectFilter)}
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

      {projectNames.length > 1 ? (
        <select
          className="project-filter"
          aria-label="Filter by project"
          value={projectFilter}
          onChange={(event) => setProjectFilter(event.target.value)}
        >
          <option value={allProjectsFilter}>All projects</option>
          {projectNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      ) : null}

      {pinned.length ? (
        <section className="nav-section">
          <h2>Pinned</h2>
          {pinned.map(renderRow)}
        </section>
      ) : null}

      <section className="nav-section grow">
        <h2>Recent</h2>
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
    </aside>
  );
}
