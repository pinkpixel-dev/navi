import { describe, expect, test } from "vitest";
import {
  activePresetOptions,
  buildPresetMcpServerConfig,
  mcpToolPresets,
  migrateLegacyPresetServer,
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
      "image-generation",
    ]);
  });
});

describe("image generation preset", () => {
  const imagePreset = mcpToolPresets.find((preset) => preset.id === "image-generation")!;

  test("runs pixara for OpenRouter and imaginate for the direct providers", () => {
    expect(
      buildPresetMcpServerConfig("image-generation", {
        provider: "openrouter",
        openrouterApiKey: "sk-or-key",
        openrouterOutputDirectory: "/images",
      }),
    ).toEqual({
      id: presetServerId("image-generation"),
      name: "Image Generation",
      enabled: true,
      transport: "stdio",
      command: "npx",
      args: ["-y", "@pinkpixel/pixara-mcp"],
      env: {
        NAVI_IMAGE_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "sk-or-key",
        OPENROUTER_IMAGE_OUTPUT_DIR: "/images",
      },
    });

    for (const provider of ["openai", "gemini"]) {
      const config = buildPresetMcpServerConfig("image-generation", {
        provider,
        [provider === "openai" ? "openaiApiKey" : "geminiApiKey"]: "provider-key",
      });

      expect(config.args).toEqual(["-y", "@pinkpixel/imaginate-mcp"]);
      expect(config.id).toBe(presetServerId("image-generation"));
    }
  });

  test("writes only the selected provider's key so the server registers one provider", () => {
    const config = buildPresetMcpServerConfig("image-generation", {
      provider: "gemini",
      geminiApiKey: "gemini-key",
      // Left over from an earlier selection.
      openaiApiKey: "openai-key",
      openrouterApiKey: "sk-or-key",
      openrouterOutputDirectory: "/images",
    });

    expect(config.env).toEqual({ NAVI_IMAGE_PROVIDER: "gemini", GEMINI_API_KEY: "gemini-key" });
  });

  test("only requires the fields for the chosen provider", () => {
    expect(missingRequiredPresetOptions("image-generation", {})).toEqual(["provider"]);
    expect(missingRequiredPresetOptions("image-generation", { provider: "openrouter" })).toEqual([
      "openrouterApiKey",
      "openrouterOutputDirectory",
    ]);
    expect(missingRequiredPresetOptions("image-generation", { provider: "gemini" })).toEqual(["geminiApiKey"]);
    expect(
      missingRequiredPresetOptions("image-generation", { provider: "gemini", geminiApiKey: "gemini-key" }),
    ).toEqual([]);
  });

  test("shows only the chosen provider's fields", () => {
    expect(activePresetOptions(imagePreset, {}).map((option) => option.key)).toEqual(["provider"]);
    expect(activePresetOptions(imagePreset, { provider: "openai" }).map((option) => option.key)).toEqual([
      "provider",
      "openaiApiKey",
      "imaginateOutputDirectory",
    ]);
  });

  test("migrates a saved OpenRouter image tool to the combined preset", () => {
    const migrated = migrateLegacyPresetServer({
      id: "preset:pixara",
      name: "Image Generation",
      enabled: true,
      transport: "stdio",
      command: "npx",
      args: ["-y", "@pinkpixel/pixara-mcp"],
      env: { OPENROUTER_API_KEY: "sk-or-key", OPENROUTER_IMAGE_OUTPUT_DIR: "/images" },
    });

    expect(migrated).toEqual({
      id: presetServerId("image-generation"),
      name: "Image Generation",
      enabled: true,
      transport: "stdio",
      command: "npx",
      args: ["-y", "@pinkpixel/pixara-mcp"],
      env: {
        NAVI_IMAGE_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "sk-or-key",
        OPENROUTER_IMAGE_OUTPUT_DIR: "/images",
      },
    });
  });

  test("keeps a disabled legacy tool disabled and leaves other servers alone", () => {
    expect(
      migrateLegacyPresetServer({
        id: "preset:pixara",
        name: "Image Generation",
        enabled: false,
        transport: "stdio",
        command: "npx",
        args: ["-y", "@pinkpixel/pixara-mcp"],
      })?.enabled,
    ).toBe(false);

    expect(
      migrateLegacyPresetServer({
        id: "preset:context7",
        name: "Context7",
        enabled: true,
        transport: "stdio",
        command: "npx",
        args: [],
      }),
    ).toBeUndefined();

    expect(
      migrateLegacyPresetServer({
        id: "custom-server",
        name: "Mine",
        enabled: true,
        transport: "stdio",
        command: "node",
        args: ["server.js"],
      }),
    ).toBeUndefined();
  });
});
