import type { ToolCallEvent } from "../conversation/types";
import type { ProviderToolSchema } from "../providers/types";
import type { McpTool } from "./mcpServer";

export function toProviderToolSchema(tool: McpTool): ProviderToolSchema {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? { type: "object", properties: {} },
    },
  };
}

function nameBasedRisk(toolName: string): ToolCallEvent["risk"] {
  const lowerName = toolName.toLowerCase();

  if (lowerName.includes("delete") || lowerName.includes("remove")) {
    return "destructive";
  }

  if (lowerName.includes("create") || lowerName.includes("write") || lowerName.includes("update")) {
    return "write";
  }

  return "read";
}

/**
 * Real MCP tools carry risk hints in their `annotations` (readOnlyHint/destructiveHint).
 * Prefer those over the name-substring heuristic when a tool actually provides them.
 */
export function mcpToolRisk(tool: McpTool): ToolCallEvent["risk"] {
  const annotations = tool.annotations;
  if (!annotations) {
    return nameBasedRisk(tool.name);
  }

  if (annotations.destructiveHint === true) {
    return "destructive";
  }

  if (annotations.readOnlyHint === true) {
    return "read";
  }

  if (annotations.readOnlyHint === false) {
    return "write";
  }

  return nameBasedRisk(tool.name);
}
