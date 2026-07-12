import { describe, expect, test } from "vitest";
import { mcpToolRisk, toProviderToolSchema } from "./mcpToolSchema";
import type { McpTool } from "./mcpServer";

describe("toProviderToolSchema", () => {
  test("maps an MCP tool to an OpenAI-style function schema", () => {
    const tool: McpTool = {
      name: "echo",
      description: "Echoes a message back",
      inputSchema: { type: "object", properties: { message: { type: "string" } } },
    };

    expect(toProviderToolSchema(tool)).toEqual({
      type: "function",
      function: {
        name: "echo",
        description: "Echoes a message back",
        parameters: { type: "object", properties: { message: { type: "string" } } },
      },
    });
  });

  test("falls back to an empty object schema when inputSchema is missing", () => {
    const tool: McpTool = { name: "ping" };
    expect(toProviderToolSchema(tool).function.parameters).toEqual({ type: "object", properties: {} });
  });
});

describe("mcpToolRisk", () => {
  test("uses destructiveHint when present", () => {
    const tool: McpTool = { name: "safe_sounding_name", annotations: { destructiveHint: true } };
    expect(mcpToolRisk(tool)).toBe("destructive");
  });

  test("uses readOnlyHint true as read", () => {
    const tool: McpTool = { name: "modify_thing", annotations: { readOnlyHint: true } };
    expect(mcpToolRisk(tool)).toBe("read");
  });

  test("uses readOnlyHint false as write when not destructive", () => {
    const tool: McpTool = { name: "innocuous_name", annotations: { readOnlyHint: false } };
    expect(mcpToolRisk(tool)).toBe("write");
  });

  test("falls back to name heuristic when there are no annotations", () => {
    expect(mcpToolRisk({ name: "delete_file" })).toBe("destructive");
    expect(mcpToolRisk({ name: "create_file" })).toBe("write");
    expect(mcpToolRisk({ name: "read_file" })).toBe("read");
  });

  test("falls back to name heuristic when annotations give no clear signal", () => {
    const tool: McpTool = { name: "delete_file", annotations: { openWorldHint: true } };
    expect(mcpToolRisk(tool)).toBe("destructive");
  });
});
