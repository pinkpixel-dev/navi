import type { McpServerConfig } from "../mcp/mcpServer";

export type McpToolPresetId =
  | "web-scout"
  | "notifications"
  | "sequential-thinking"
  | "datetime"
  | "memory"
  | "context7"
  | "image-generation";

/** Server ids written by versions that shipped the OpenRouter-only image tool. */
export const legacyPresetServerIds: Record<string, McpToolPresetId> = {
  "preset:pixara": "image-generation",
};

export type McpToolPresetOptionType = "text" | "password" | "select" | "directory" | "file";

export interface McpToolPresetOption {
  key: string;
  label: string;
  envKey: string;
  type: McpToolPresetOptionType;
  required: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  /**
   * Limits the option to certain values of another option. A hidden option is
   * never shown, never required, and never written to the server environment.
   */
  showWhen?: { key: string; values: string[] };
}

export interface McpToolPresetRuntime {
  command: string;
  args: string[];
}

export interface McpToolPreset {
  id: McpToolPresetId;
  name: string;
  description: string;
  command: string;
  args: string[];
  defaultEnv?: Record<string, string>;
  options: McpToolPresetOption[];
  /**
   * Lets one preset card run different packages. The value of `runtimeOptionKey`
   * selects an entry in `runtimes`; anything unmatched falls back to the preset's
   * own `command` and `args`.
   */
  runtimeOptionKey?: string;
  runtimes?: Record<string, McpToolPresetRuntime>;
}

export type McpToolPresetValues = Record<string, string>;

export const timezoneOptions = [
  { value: "America/New_York", label: "Eastern Time" },
  { value: "America/Chicago", label: "Central Time" },
  { value: "America/Denver", label: "Mountain Time" },
  { value: "America/Los_Angeles", label: "Pacific Time" },
  { value: "America/Phoenix", label: "Arizona" },
  { value: "America/Anchorage", label: "Alaska Time" },
  { value: "America/Honolulu", label: "Hawaii Time" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Paris", label: "Paris" },
  { value: "Europe/Berlin", label: "Berlin" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Asia/Shanghai", label: "Shanghai" },
  { value: "Asia/Seoul", label: "Seoul" },
  { value: "Asia/Kolkata", label: "India" },
  { value: "Australia/Sydney", label: "Sydney" },
  { value: "Pacific/Auckland", label: "Auckland" },
  { value: "UTC", label: "UTC" },
];

export const mcpToolPresets: McpToolPreset[] = [
  {
    id: "web-scout",
    name: "Web Search",
    description: "Search the internet and scrape public URLs through DuckDuckGo.",
    command: "npx",
    args: ["@pinkpixel/web-scout-mcp"],
    options: [],
  },
  {
    id: "notifications",
    name: "Notifications",
    description: "Let the model send local completion notifications with toast and sound.",
    command: "npx",
    args: ["-y", "@pinkpixel/notification-mcp"],
    defaultEnv: { MCP_NOTIFICATION_SOUND: "random" },
    options: [],
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    description: "Give the model a scratchpad-style step-by-step reasoning tool.",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    options: [],
  },
  {
    id: "datetime",
    name: "Date & Time",
    description: "Provide current date and time context in a selected timezone.",
    command: "npx",
    args: ["@pinkpixel/datetime-mcp"],
    options: [
      {
        key: "timezone",
        label: "Timezone",
        envKey: "TZ",
        type: "select",
        required: true,
        options: timezoneOptions,
      },
    ],
  },
  {
    id: "memory",
    name: "Memory",
    description: "Store and retrieve model-readable information across sessions.",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    options: [
      {
        key: "memoryFilePath",
        label: "Memory file path",
        envKey: "MEMORY_FILE_PATH",
        type: "file",
        required: true,
        placeholder: "/path/to/memory.jsonl",
      },
    ],
  },
  {
    id: "context7",
    name: "Documentation",
    description: "Retrieve current library and framework documentation through Context7.",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    options: [
      {
        key: "apiKey",
        label: "Context7 API key",
        envKey: "CONTEXT7_API_KEY",
        type: "password",
        required: true,
        placeholder: "ctx...",
      },
    ],
  },
  {
    id: "image-generation",
    name: "Image Generation",
    description: "Generate and edit images with OpenRouter, OpenAI, or Google Gemini.",
    // Default runtime. `runtimes` swaps the package once a provider is chosen.
    command: "npx",
    args: ["-y", "@pinkpixel/pixara-mcp"],
    runtimeOptionKey: "provider",
    runtimes: {
      openrouter: { command: "npx", args: ["-y", "@pinkpixel/pixara-mcp"] },
      openai: { command: "npx", args: ["-y", "@pinkpixel/imaginate-mcp"] },
      gemini: { command: "npx", args: ["-y", "@pinkpixel/imaginate-mcp"] },
    },
    options: [
      {
        key: "provider",
        label: "Image provider",
        envKey: "NAVI_IMAGE_PROVIDER",
        type: "select",
        required: true,
        options: [
          { value: "openrouter", label: "OpenRouter" },
          { value: "openai", label: "OpenAI" },
          { value: "gemini", label: "Google Gemini" },
        ],
      },
      {
        key: "openrouterApiKey",
        label: "OpenRouter API key",
        envKey: "OPENROUTER_API_KEY",
        type: "password",
        required: true,
        placeholder: "sk-or-...",
        showWhen: { key: "provider", values: ["openrouter"] },
      },
      {
        key: "openaiApiKey",
        label: "OpenAI API key",
        envKey: "OPENAI_API_KEY",
        type: "password",
        required: true,
        placeholder: "sk-...",
        showWhen: { key: "provider", values: ["openai"] },
      },
      {
        key: "geminiApiKey",
        label: "Gemini API key",
        envKey: "GEMINI_API_KEY",
        type: "password",
        required: true,
        placeholder: "AIza...",
        showWhen: { key: "provider", values: ["gemini"] },
      },
      {
        key: "openrouterOutputDirectory",
        label: "Image output directory",
        envKey: "OPENROUTER_IMAGE_OUTPUT_DIR",
        type: "directory",
        required: true,
        placeholder: "/path/to/saved/images",
        showWhen: { key: "provider", values: ["openrouter"] },
      },
      {
        key: "imaginateOutputDirectory",
        label: "Image output directory (optional)",
        envKey: "IMAGINATE_OUTPUT_DIR",
        type: "directory",
        required: false,
        placeholder: "~/Pictures/imaginate",
        showWhen: { key: "provider", values: ["openai", "gemini"] },
      },
    ],
  },
];

/** True when the option applies to the currently selected values. */
export function isPresetOptionActive(option: McpToolPresetOption, values: McpToolPresetValues): boolean {
  if (!option.showWhen) {
    return true;
  }
  return option.showWhen.values.includes(values[option.showWhen.key] ?? "");
}

export function activePresetOptions(
  preset: McpToolPreset,
  values: McpToolPresetValues,
): McpToolPresetOption[] {
  return preset.options.filter((option) => isPresetOptionActive(option, values));
}

export function resolvePresetRuntime(preset: McpToolPreset, values: McpToolPresetValues): McpToolPresetRuntime {
  const selected = preset.runtimeOptionKey ? values[preset.runtimeOptionKey] : undefined;
  const runtime = selected ? preset.runtimes?.[selected] : undefined;
  return runtime ?? { command: preset.command, args: preset.args };
}

export function presetServerId(presetId: McpToolPresetId): string {
  return `preset:${presetId}`;
}

export function presetForServerId(serverId: string): McpToolPreset | undefined {
  if (!serverId.startsWith("preset:")) {
    return undefined;
  }
  return mcpToolPresets.find((preset) => presetServerId(preset.id) === serverId);
}

export function missingRequiredPresetOptions(presetId: McpToolPresetId, values: McpToolPresetValues): string[] {
  const preset = mcpToolPresets.find((item) => item.id === presetId);
  if (!preset) {
    return [];
  }
  return activePresetOptions(preset, values)
    .filter((option) => option.required && !values[option.key]?.trim())
    .map((option) => option.key);
}

export function valuesFromPresetServerConfig(preset: McpToolPreset, server?: McpServerConfig): McpToolPresetValues {
  const values: McpToolPresetValues = {};
  for (const option of preset.options) {
    values[option.key] = server?.env?.[option.envKey] ?? "";
  }
  return values;
}

export function buildPresetMcpServerConfig(
  presetId: McpToolPresetId,
  values: McpToolPresetValues,
  enabled = true,
): McpServerConfig {
  const preset = mcpToolPresets.find((item) => item.id === presetId);
  if (!preset) {
    throw new Error(`Unknown MCP tool preset '${presetId}'.`);
  }

  const env: Record<string, string> = { ...(preset.defaultEnv ?? {}) };
  // Only active options are written, so switching an image provider never leaves
  // the other provider's key in the environment where the server would pick it up.
  for (const option of activePresetOptions(preset, values)) {
    const value = values[option.key]?.trim();
    if (value) {
      env[option.envKey] = value;
    }
  }

  const runtime = resolvePresetRuntime(preset, values);

  return {
    id: presetServerId(preset.id),
    name: preset.name,
    enabled,
    transport: "stdio",
    command: runtime.command,
    args: runtime.args,
    env: Object.keys(env).length ? env : undefined,
  };
}

/**
 * Rewrites server configs saved under a preset id that no longer exists. The
 * OpenRouter-only image tool became one Image Generation preset with a provider
 * choice, so its saved key and output directory carry over as the OpenRouter one.
 */
export function migrateLegacyPresetServer(server: McpServerConfig): McpServerConfig | undefined {
  const presetId = legacyPresetServerIds[server.id];
  if (!presetId) {
    return undefined;
  }

  const preset = mcpToolPresets.find((item) => item.id === presetId);
  if (!preset) {
    return undefined;
  }

  const values: McpToolPresetValues = {};
  if (presetId === "image-generation") {
    values.provider = "openrouter";
  }
  for (const option of preset.options) {
    const saved = server.env?.[option.envKey];
    if (saved && !values[option.key]) {
      values[option.key] = saved;
    }
  }

  return buildPresetMcpServerConfig(presetId, values, server.enabled);
}
