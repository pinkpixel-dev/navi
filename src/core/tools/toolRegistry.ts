import type { ToolDefinition } from "./types";

export const toolRegistry: ToolDefinition[] = [
  {
    name: "read_plan",
    label: "Read product plan",
    serverName: "Local project",
    risk: "read",
    description: "Reads local product planning notes and returns a concise summary.",
  },
  {
    name: "create_artifact",
    label: "Create canvas artifact",
    serverName: "Canvas",
    risk: "write",
    description: "Creates a draft artifact linked to the active conversation.",
  },
];
