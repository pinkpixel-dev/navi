import { invoke } from "@tauri-apps/api/core";

export type McpTransport = "stdio" | "http";

export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpTransport;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpResource {
  uri: string;
  name?: string;
  description?: string;
}

export interface McpPrompt {
  name: string;
  description?: string;
}

export type McpConnectionState = "idle" | "connecting" | "connected" | "error";

export interface McpServerStatus {
  state: McpConnectionState;
  message: string | null;
  instructions: string | null;
  tools: McpTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
}

export interface McpServerDriver {
  saveServer: (config: McpServerConfig) => Promise<void>;
  loadServers: () => Promise<McpServerConfig[]>;
  removeServer: (id: string) => Promise<void>;
  testConnection: (config: McpServerConfig) => Promise<McpServerStatus>;
  connectServer: (config: McpServerConfig) => Promise<McpServerStatus>;
  disconnectServer: (id: string) => Promise<void>;
  getServerStatus: (id: string) => Promise<McpServerStatus>;
}

export function createTauriMcpServerDriver(): McpServerDriver {
  return {
    saveServer: (config) => invoke<void>("save_mcp_server", { config }),
    loadServers: () => invoke<McpServerConfig[]>("load_mcp_servers"),
    removeServer: (id) => invoke<void>("remove_mcp_server", { id }),
    testConnection: (config) => invoke<McpServerStatus>("test_mcp_connection", { config }),
    connectServer: (config) => invoke<McpServerStatus>("connect_mcp_server", { config }),
    disconnectServer: (id) => invoke<void>("disconnect_mcp_server", { id }),
    getServerStatus: (id) => invoke<McpServerStatus>("get_mcp_server_status", { id }),
  };
}

const idleStatus: McpServerStatus = {
  state: "idle",
  message: null,
  instructions: null,
  tools: [],
  resources: [],
  prompts: [],
};

export function createUnsupportedMcpServerDriver(): McpServerDriver {
  const unsupported = () => Promise.reject(new Error("MCP servers are only available in the desktop app."));

  return {
    saveServer: unsupported,
    loadServers: () => Promise.resolve([]),
    removeServer: () => Promise.resolve(),
    testConnection: unsupported,
    connectServer: unsupported,
    disconnectServer: () => Promise.resolve(),
    getServerStatus: () => Promise.resolve(idleStatus),
  };
}

export function createDefaultMcpServerDriver(): McpServerDriver {
  const isTauri = "__TAURI_INTERNALS__" in window;
  return isTauri ? createTauriMcpServerDriver() : createUnsupportedMcpServerDriver();
}
