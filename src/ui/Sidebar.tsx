import { KeyboardEvent, useState } from "react";
import { MessageSquarePlus, Pencil, Pin, PinOff, Search, Settings, Trash2 } from "lucide-react";
import type { Conversation } from "../core/conversation/types";
import { formatRelativeTime } from "../core/conversation/formatRelativeTime";

interface SidebarProps {
  activeConversationId: string;
  conversations: Conversation[];
  onNewChat: () => void;
  onOpenSettings: () => void;
  onSelectConversation: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
  onTogglePin: (conversationId: string) => void;
  onRenameConversation: (conversationId: string, title: string) => void;
}

interface ChatRowProps {
  conversation: Conversation;
  isActive: boolean;
  isRenaming: boolean;
  renameDraft: string;
  onSelect: () => void;
  onStartRename: () => void;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}

function ChatRow({
  conversation,
  isActive,
  isRenaming,
  renameDraft,
  onSelect,
  onStartRename,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  onTogglePin,
  onDelete,
}: ChatRowProps) {
  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onCommitRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancelRename();
    }
  };

  return (
    <div className={isActive ? "chat-row active" : "chat-row"}>
      <button className="chat-row-select" type="button" onClick={onSelect}>
        {conversation.isPinned ? <Pin size={13} className="chat-row-pin-mark" /> : null}
        {isRenaming ? (
          <input
            className="chat-row-rename-input"
            autoFocus
            value={renameDraft}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onRenameDraftChange(event.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={onCommitRename}
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
            onStartRename();
          }}
        >
          <Pencil size={13} />
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
  onRenameConversation,
}: SidebarProps) {
  const [searchText, setSearchText] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const startRename = (conversation: Conversation) => {
    setRenamingId(conversation.id);
    setRenameDraft(conversation.title);
  };

  const commitRename = () => {
    if (renamingId) {
      onRenameConversation(renamingId, renameDraft);
    }
    setRenamingId(null);
  };

  const cancelRename = () => {
    setRenamingId(null);
  };

  const matchesSearch = (conversation: Conversation) =>
    conversation.title.toLowerCase().includes(searchText.trim().toLowerCase());

  const filtered = conversations.filter(matchesSearch);
  const pinned = filtered.filter((conversation) => conversation.isPinned);
  const recent = filtered.filter((conversation) => !conversation.isPinned);

  const renderRow = (conversation: Conversation) => (
    <ChatRow
      key={conversation.id}
      conversation={conversation}
      isActive={conversation.id === activeConversationId}
      isRenaming={conversation.id === renamingId}
      renameDraft={renameDraft}
      onSelect={() => onSelectConversation(conversation.id)}
      onStartRename={() => startRename(conversation)}
      onRenameDraftChange={setRenameDraft}
      onCommitRename={commitRename}
      onCancelRename={cancelRename}
      onTogglePin={() => onTogglePin(conversation.id)}
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

      <button className="primary-button" type="button" onClick={onNewChat}>
        <MessageSquarePlus size={16} />
        New chat
      </button>

      <label className="search-box">
        <Search size={15} />
        <input
          placeholder="Search chats"
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

      <section className="nav-section grow">
        <h2>Recent</h2>
        {recent.length ? (
          recent.map(renderRow)
        ) : filtered.length === 0 && searchText.trim() ? (
          <p className="chat-row-empty">No chats match &ldquo;{searchText.trim()}&rdquo;.</p>
        ) : null}
      </section>

      <button className="ghost-button" type="button" onClick={onOpenSettings}>
        <Settings size={16} />
        Settings
      </button>
    </aside>
  );
}
