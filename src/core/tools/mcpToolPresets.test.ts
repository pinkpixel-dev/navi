import { describe, expect, test } from "vitest";
import {
  buildPresetMcpServerConfig,
  mcpToolPresets,
  missingRequiredPresetOptions,
  presetServerId,
} from "./mcpToolPresets";

describe("mcp tool presets", () => {
  test("builds a toggle-only stdio MCP server config", () => {
    expect(buildPresetMcpServerConfig("web-scout", {})).toEqual({
      id: presetServerId("web-scout"),
      name: "Web Search",
      enabled: true,
      transport: "stdio",
      command: "npx",
      args: ["@pinkpixel/web-scout-mcp"],
      env: undefined,
    });
  });

  test("builds a stdio MCP server config with selected options in env", () => {
    expect(buildPresetMcpServerConfig("datetime", { timezone: "America/New_York" })).toEqual({
      id: presetServerId("datetime"),
      name: "Date & Time",
      enabled: true,
      transport: "stdio",
      command: "npx",
      args: ["@pinkpixel/datetime-mcp"],
      env: {
        TZ: "America/New_York",
      },
    });
  });

  test("reports missing required preset options", () => {
    expect(missingRequiredPresetOptions("context7", {})).toEqual(["apiKey"]);
    expect(missingRequiredPresetOptions("context7", { apiKey: "ctx-key" })).toEqual([]);
  });

  test("defines every preset from the curated tool list", () => {
    expect(mcpToolPresets.map((preset) => preset.id)).toEqual([
      "web-scout",
      "notifications",
      "sequential-thinking",
      "datetime",
      "memory",
      "context7",
      "pixara",
    ]);
  });
});
