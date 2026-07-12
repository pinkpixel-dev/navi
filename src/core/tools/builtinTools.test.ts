import { describe, expect, test } from "vitest";
import {
  builtinTools,
  builtinToolSchema,
  defaultEnabledBuiltinToolNames,
  enabledBuiltinTools,
  evaluateExpression,
} from "./builtinTools";

function tool(name: string) {
  const found = builtinTools.find((candidate) => candidate.name === name);
  if (!found) {
    throw new Error(`No builtin tool named ${name}`);
  }
  return found;
}

describe("evaluateExpression", () => {
  test("evaluates arithmetic with precedence and parentheses", () => {
    expect(evaluateExpression("2 + 3 * 4")).toBe(14);
    expect(evaluateExpression("(2 + 3) * 4")).toBe(20);
    expect(evaluateExpression("2 ^ 3 ^ 2")).toBe(512);
    expect(evaluateExpression("10 % 3")).toBe(1);
    expect(evaluateExpression("-4 + 6 / 2")).toBe(-1);
  });

  test("rejects invalid expressions", () => {
    expect(() => evaluateExpression("2 +")).toThrow();
    expect(() => evaluateExpression("(1 + 2")).toThrow();
    expect(() => evaluateExpression("alert(1)")).toThrow();
  });
});

describe("builtin tools", () => {
  test("calculate returns the evaluated result", async () => {
    const result = await tool("calculate").execute({ expression: "6 * 7" });
    expect(result).toEqual({ content: "6 * 7 = 42", isError: false });
  });

  test("calculate reports bad expressions as errors", async () => {
    const result = await tool("calculate").execute({ expression: "process.exit()" });
    expect(result.isError).toBe(true);
  });

  test("get_current_time returns an ISO timestamp", async () => {
    const result = await tool("get_current_time").execute({});
    expect(result.isError).toBe(false);
    expect(result.content).toMatch(/ISO: \d{4}-\d{2}-\d{2}T/);
  });

  test("get_current_time rejects unknown timezones", async () => {
    const result = await tool("get_current_time").execute({ timezone: "Not/AZone" });
    expect(result.isError).toBe(true);
  });

  test("generate_uuid clamps the count", async () => {
    const result = await tool("generate_uuid").execute({ count: 3 });
    expect(result.content.split("\n")).toHaveLength(3);
  });

  test("random_number stays within bounds", async () => {
    const result = await tool("random_number").execute({ min: 5, max: 5 });
    expect(result.content).toBe("5");
  });

  test("fetch_url rejects non-http urls without fetching", async () => {
    const result = await tool("fetch_url").execute({ url: "file:///etc/passwd" });
    expect(result.isError).toBe(true);
  });

  test("network tools are excluded from the default enabled set", () => {
    expect(defaultEnabledBuiltinToolNames()).not.toContain("fetch_url");
    expect(enabledBuiltinTools().map((enabled) => enabled.name)).toEqual(defaultEnabledBuiltinToolNames());
    expect(enabledBuiltinTools(["fetch_url"]).map((enabled) => enabled.name)).toEqual(["fetch_url"]);
  });

  test("builds provider tool schemas", () => {
    expect(builtinToolSchema(tool("calculate"))).toEqual({
      type: "function",
      function: {
        name: "calculate",
        description: expect.stringContaining("arithmetic"),
        parameters: expect.objectContaining({ type: "object" }),
      },
    });
  });
});
