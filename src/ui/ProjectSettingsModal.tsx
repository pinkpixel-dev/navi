import { X } from "lucide-react";
import {
  projectColorOptions,
  projectIconOptions,
  type ProjectColor,
  type ProjectIcon,
  type ProjectSettings,
} from "../core/projects/projectSettings";
import { ProjectIconMark } from "./projectVisuals";

interface ProjectSettingsModalProps {
  project: ProjectSettings;
  onChange: (project: ProjectSettings) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}

export function ProjectSettingsModal({ project, onChange, onClose, onSave, onDelete }: ProjectSettingsModalProps) {
  return (
    <div className="project-modal-scrim" role="dialog" aria-modal="true" aria-label="Project settings">
      <div className="project-modal">
        <header>
          <h3>Project settings</h3>
          <button type="button" aria-label="Close project settings" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <label>
          <span>Project name</span>
          <input value={project.name} onChange={(event) => onChange({ ...project, name: event.target.value })} />
        </label>
        <div className="project-picker-section">
          <span>Icon</span>
          <div className="project-icon-picker">
            {projectIconOptions.map((option) => (
              <button
                type="button"
                className={project.icon === option.value ? "active" : ""}
                key={option.value}
                aria-label={option.label}
                aria-pressed={project.icon === option.value}
                onClick={() => onChange({ ...project, icon: option.value as ProjectIcon })}
              >
                <ProjectIconMark icon={option.value} color={project.color} size={16} />
              </button>
            ))}
          </div>
        </div>
        <div className="project-picker-section">
          <span>Color</span>
          <div className="project-color-picker">
            {projectColorOptions.map((option) => (
              <button
                type="button"
                className={project.color === option.value ? `project-color-dot project-${option.value} active` : `project-color-dot project-${option.value}`}
                key={option.value}
                aria-label={option.label}
                aria-pressed={project.color === option.value}
                onClick={() => onChange({ ...project, color: option.value as ProjectColor })}
              />
            ))}
          </div>
        </div>
        <label>
          <span>Instructions</span>
          <textarea
            value={project.instructions}
            onChange={(event) => onChange({ ...project, instructions: event.target.value })}
            placeholder="Set context for chats in this project."
            rows={5}
          />
        </label>
        <div className="project-modal-actions">
          <button className="project-delete-button" type="button" onClick={onDelete}>
            Delete project
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={onSave}>
            Save project
          </button>
        </div>
      </div>
    </div>
  );
}
