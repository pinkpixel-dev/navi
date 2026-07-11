import { MessageSquarePlus, Pin, Search, Settings } from "lucide-react";
import type { Conversation } from "../core/conversation/types";

interface SidebarProps {
  activeConversationId: string;
  conversations: Conversation[];
  onNewChat: () => void;
  onOpenSettings: () => void;
  onSelectConversation: (conversationId: string) => void;
}

export function Sidebar({
  activeConversationId,
  conversations,
  onNewChat,
  onOpenSettings,
  onSelectConversation,
}: SidebarProps) {
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
        <input placeholder="Search chats" />
      </label>

      <section className="nav-section">
        <h2>Pinned</h2>
        {conversations
          .filter((conversation) => conversation.isPinned)
          .map((conversation) => (
            <button
              className={conversation.id === activeConversationId ? "chat-row active" : "chat-row"}
              key={conversation.id}
              type="button"
              onClick={() => onSelectConversation(conversation.id)}
            >
              <Pin size={14} />
              <span>{conversation.title}</span>
            </button>
          ))}
      </section>

      <section className="nav-section grow">
        <h2>Recent</h2>
        {conversations.map((conversation) => (
          <button
            className={conversation.id === activeConversationId ? "chat-row active" : "chat-row"}
            key={conversation.id}
            type="button"
            onClick={() => onSelectConversation(conversation.id)}
          >
            <span>{conversation.title}</span>
            <small>{conversation.updatedAt}</small>
          </button>
        ))}
      </section>

      <button className="ghost-button" type="button" onClick={onOpenSettings}>
        <Settings size={16} />
        Settings
      </button>
    </aside>
  );
}
