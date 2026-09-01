import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  FolderInput,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import type { Conversation } from "../core/conversation/types";
import { defaultProjectName, type ProjectSettings } from "../core/projects/projectSettings";
import { ProjectIconMark } from "./projectVisuals";

interface ChatActionsMenuProps {
  className?: string;
  conversation: Conversation;
  projectOptions: ProjectSettings[];
  onStartEdit: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
  onMoveToProject: (projectName: string) => void;
}

export function ChatActionsMenu({
  className = "chat-row-actions",
  conversation,
  projectOptions,
  onStartEdit,
  onTogglePin,
  onToggleArchive,
  onDelete,
  onMoveToProject,
}: ChatActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const projectChoices = projectOptions.filter((project) => project.name !== conversation.projectName);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      setIsOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleAction = (action: () => void) => {
    action();
    setIsOpen(false);
  };

  return (
    <div className={className} ref={menuRef}>
      <button
        className="chat-row-more-button"
        type="button"
        aria-label={`Open actions for ${conversation.title}`}
        title={`Chat actions for ${conversation.title}`}
        aria-expanded={isOpen}
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen((current) => !current);
        }}
      >
        <MoreHorizontal size={16} />
      </button>
      {isOpen ? (
        <div className="chat-action-popover" role="menu">
          <button type="button" role="menuitem" onClick={() => handleAction(onStartEdit)}>
            <Pencil size={13} />
            Rename
          </button>
          <button type="button" role="menuitem" onClick={() => handleAction(onTogglePin)}>
            {conversation.isPinned ? <PinOff size={13} /> : <Pin size={13} />}
            {conversation.isPinned ? "Unpin" : "Pin"}
          </button>
          <button type="button" role="menuitem" onClick={() => handleAction(onToggleArchive)}>
            {conversation.isArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
            {conversation.isArchived ? "Unarchive" : "Archive"}
          </button>
          {conversation.projectName !== defaultProjectName ? (
            <button type="button" role="menuitem" onClick={() => handleAction(() => onMoveToProject(defaultProjectName))}>
              <FolderInput size={13} />
              Move to Chats
            </button>
          ) : null}
          {projectChoices.length ? (
            <div className="chat-action-menu-group" role="group" aria-label="Move to project">
              <span>Move to project</span>
              {projectChoices.map((project) => (
                <button
                  type="button"
                  role="menuitem"
                  key={project.id}
                  onClick={() => handleAction(() => onMoveToProject(project.name))}
                >
                  <ProjectIconMark icon={project.icon} color={project.color} size={13} />
                  {project.name}
                </button>
              ))}
            </div>
          ) : null}
          <button className="chat-action-danger" type="button" role="menuitem" onClick={() => handleAction(onDelete)}>
            <Trash2 size={13} />
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}
