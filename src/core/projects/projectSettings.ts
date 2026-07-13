import type { Conversation } from "../conversation/types";

export const defaultProjectName = "Navi";

export type ProjectIcon =
  | "pen"
  | "pencil"
  | "heart"
  | "star"
  | "doc"
  | "folder"
  | "note"
  | "briefcase"
  | "palette"
  | "spark"
  | "box";
export type ProjectColor =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "cyan"
  | "purple"
  | "pink"
  | "black"
  | "white";

export interface ProjectSettings {
  id: string;
  name: string;
  icon: ProjectIcon;
  color: ProjectColor;
  instructions: string;
}

const fallbackProjects: Array<Pick<ProjectSettings, "icon" | "color">> = [
  { icon: "pen", color: "purple" },
  { icon: "heart", color: "red" },
  { icon: "folder", color: "blue" },
  { icon: "star", color: "yellow" },
  { icon: "briefcase", color: "green" },
];

export const projectIconOptions: Array<{ value: ProjectIcon; label: string }> = [
  { value: "pen", label: "Pen" },
  { value: "pencil", label: "Pencil" },
  { value: "heart", label: "Heart" },
  { value: "star", label: "Star" },
  { value: "doc", label: "Doc" },
  { value: "folder", label: "Folder" },
  { value: "note", label: "Note" },
  { value: "briefcase", label: "Briefcase" },
  { value: "palette", label: "Palette" },
  { value: "spark", label: "Spark" },
  { value: "box", label: "Box" },
];

export const projectColorOptions: Array<{ value: ProjectColor; label: string }> = [
  { value: "red", label: "Red" },
  { value: "orange", label: "Orange" },
  { value: "yellow", label: "Yellow" },
  { value: "green", label: "Green" },
  { value: "blue", label: "Blue" },
  { value: "cyan", label: "Cyan" },
  { value: "purple", label: "Purple" },
  { value: "pink", label: "Pink" },
  { value: "black", label: "Black" },
  { value: "white", label: "White" },
];

export function projectIdFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `project-${slug || crypto.randomUUID()}`;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function fallbackProjectMeta(index: number): Pick<ProjectSettings, "icon" | "color"> {
  return fallbackProjects[index % fallbackProjects.length];
}

export function createProjectSettings(name: string, index = 0): ProjectSettings {
  const trimmed = name.trim();
  const fallback = fallbackProjectMeta(index);

  return {
    id: projectIdFromName(trimmed),
    name: trimmed,
    icon: fallback.icon,
    color: fallback.color,
    instructions: "",
  };
}

export function mergeProjectSettings(
  savedProjects: ProjectSettings[] = [],
  conversations: Conversation[] = [],
): ProjectSettings[] {
  const projects = savedProjects
    .filter((project) => project.name.trim())
    .map((project) => ({ ...project, name: project.name.trim() }));
  const seen = new Set(projects.map((project) => normalizeName(project.name)));
  let discoveredCount = 0;

  for (const conversation of conversations) {
    const name = conversation.projectName.trim();
    if (!name || normalizeName(name) === normalizeName(defaultProjectName) || seen.has(normalizeName(name))) {
      continue;
    }

    projects.push(createProjectSettings(name, discoveredCount));
    seen.add(normalizeName(name));
    discoveredCount += 1;
  }

  return projects;
}
