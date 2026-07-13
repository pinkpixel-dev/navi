import type { McpServerConfig } from "../mcp/mcpServer";

export type McpToolPresetId =
  | "web-scout"
  | "notifications"
  | "sequential-thinking"
  | "datetime"
  | "memory"
  | "context7"
  | "pixara";

export type McpToolPresetOptionType = "text" | "password" | "select" | "directory" | "file";

export interface McpToolPresetOption {
  key: string;
  label: string;
  envKey: string;
  type: McpToolPresetOptionType;
  required: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface McpToolPreset {
  id: McpToolPresetId;
  name: string;
  description: string;
  command: string;
  args: string[];
  defaultEnv?: Record<string, string>;
  options: McpToolPresetOption[];
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
    id: "pixara",
    name: "Image Generation",
    description: "Generate and edit images through Pixara with OpenRouter.",
    command: "npx",
    args: ["-y", "@pinkpixel/pixara-mcp"],
    options: [
      {
        key: "apiKey",
        label: "OpenRouter API key",
        envKey: "OPENROUTER_API_KEY",
        type: "password",
        required: true,
        placeholder: "sk-or-...",
      },
      {
        key: "outputDirectory",
        label: "Image output directory",
        envKey: "OPENROUTER_IMAGE_OUTPUT_DIR",
        type: "directory",
        required: true,
        placeholder: "/path/to/saved/images",
      },
    ],
  },
];

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
  return preset.options
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
  for (const option of preset.options) {
    const value = values[option.key]?.trim();
    if (value) {
      env[option.envKey] = value;
    }
  }

  return {
    id: presetServerId(preset.id),
    name: preset.name,
    enabled,
    transport: "stdio",
    command: preset.command,
    args: preset.args,
    env: Object.keys(env).length ? env : undefined,
  };
}
