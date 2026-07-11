export interface ToolDefinition {
  name: string;
  label: string;
  serverName: string;
  risk: "read" | "write" | "destructive" | "network";
  description: string;
}
