import { useEffect, useRef, useState } from "react";
import { FolderInput } from "lucide-react";
import { defaultProjectName, type ProjectSettings } from "../core/projects/projectSettings";
import { ProjectIconMark } from "./projectVisuals";

interface ProjectMoveMenuProps {
  chatTitle: string;
  currentProjectName: string;
  projects: ProjectSettings[];
  includeUnsorted?: boolean;
  onMove: (projectName: string) => void;
}

export function ProjectMoveMenu({
  chatTitle,
  currentProjectName,
  projects,
  includeUnsorted = false,
  onMove,
}: ProjectMoveMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const projectChoices = projects.filter((project) => project.name !== currentProjectName);
  const hasChoices = includeUnsorted || projectChoices.length > 0;

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

  const handleMove = (projectName: string) => {
    onMove(projectName);
    setIsOpen(false);
  };

  return (
    <div className="project-move-menu" ref={menuRef}>
      <button
        type="button"
        aria-label={`Move ${chatTitle} to project`}
        aria-expanded={isOpen}
        disabled={!hasChoices}
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen((current) => !current);
        }}
      >
        <FolderInput size={13} />
      </button>
      {isOpen ? (
        <div className="project-move-popover" role="menu">
          {includeUnsorted ? (
            <button type="button" role="menuitem" onClick={() => handleMove(defaultProjectName)}>
              <span className="project-move-placeholder" />
              Chats
            </button>
          ) : null}
          {projectChoices.map((project) => (
            <button type="button" role="menuitem" key={project.id} onClick={() => handleMove(project.name)}>
              <ProjectIconMark icon={project.icon} color={project.color} size={13} />
              {project.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
