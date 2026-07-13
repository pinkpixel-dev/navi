import {
  Box,
  BriefcaseBusiness,
  FileText,
  Folder,
  Heart,
  Palette,
  Pencil,
  PenLine,
  Sparkles,
  Star,
  StickyNote,
} from "lucide-react";
import type { ProjectColor, ProjectIcon } from "../core/projects/projectSettings";

export const projectIconMap: Record<ProjectIcon, typeof PenLine> = {
  pen: PenLine,
  pencil: Pencil,
  heart: Heart,
  star: Star,
  doc: FileText,
  folder: Folder,
  note: StickyNote,
  briefcase: BriefcaseBusiness,
  palette: Palette,
  spark: Sparkles,
  box: Box,
};

export function ProjectIconMark({ icon, color, size = 15 }: { icon: ProjectIcon; color: ProjectColor; size?: number }) {
  const Icon = projectIconMap[icon];
  return <Icon className={`project-icon project-${color}`} size={size} />;
}
