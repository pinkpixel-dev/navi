import { describe, expect, test } from "vitest";
import { createUnsupportedMcpServerDriver } from "./mcpServer";

describe("mcp server driver outside Tauri", () => {
  test("reports no saved servers and an idle status", async () => {
    const driver = createUnsupportedMcpServerDriver();

    expect(await driver.loadServers()).toEqual([]);
    expect(await driver.getServerStatus("server-1")).toEqual({
      state: "idle",
      message: null,
      instructions: null,
      tools: [],
      resources: [],
      prompts: [],
    });
  });

  test("rejects attempts to save, test, connect, or call a tool", async () => {
    const driver = createUnsupportedMcpServerDriver();
    const config = { id: "server-1", name: "Test", enabled: true, transport: "stdio" as const };

    await expect(driver.saveServer(config)).rejects.toThrow("only available in the desktop app");
    await expect(driver.testConnection(config)).rejects.toThrow("only available in the desktop app");
    await expect(driver.connectServer(config)).rejects.toThrow("only available in the desktop app");
    await expect(driver.callTool("server-1", "echo", "{}")).rejects.toThrow("only available in the desktop app");
  });
});
