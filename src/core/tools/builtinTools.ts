import type { ToolCallEvent } from "../conversation/types";
import type { ProviderToolSchema } from "../providers/types";

export interface BuiltinToolResult {
  content: string;
  isError: boolean;
}

export interface BuiltinTool {
  name: string;
  description: string;
  parameters: unknown;
  risk: ToolCallEvent["risk"];
  /** Enabled unless the user turned it off; riskier tools can default to off. */
  enabledByDefault: boolean;
  execute: (args: Record<string, unknown>) => Promise<BuiltinToolResult>;
}

export const builtinServerName = "Built-in";

/**
 * Tiny arithmetic evaluator so the calculator tool never touches eval().
 * Supports + - * / % ^, parentheses, and unary minus.
 */
export function evaluateExpression(expression: string): number {
  let position = 0;

  const peek = (): string => expression[position] ?? "";
  const skipSpaces = () => {
    while (peek() === " ") {
      position += 1;
    }
  };

  const parseNumber = (): number => {
    skipSpaces();
    const start = position;
    while (/[0-9.]/.test(peek())) {
      position += 1;
    }
    if (start === position) {
      throw new Error(`Unexpected character '${peek() || "end of input"}' at position ${position}.`);
    }
    const value = Number(expression.slice(start, position));
    if (Number.isNaN(value)) {
      throw new Error(`Invalid number at position ${start}.`);
    }
    return value;
  };

  const parseFactor = (): number => {
    skipSpaces();
    if (peek() === "-") {
      position += 1;
      return -parseFactor();
    }
    if (peek() === "(") {
      position += 1;
      const value = parseExpression();
      skipSpaces();
      if (peek() !== ")") {
        throw new Error("Missing closing parenthesis.");
      }
      position += 1;
      return value;
    }
    return parseNumber();
  };

  const parsePower = (): number => {
    const base = parseFactor();
    skipSpaces();
    if (peek() === "^") {
      position += 1;
      return base ** parsePower();
    }
    return base;
  };

  const parseTerm = (): number => {
    let value = parsePower();
    while (true) {
      skipSpaces();
      const operator = peek();
      if (operator === "*" || operator === "/" || operator === "%") {
        position += 1;
        const rhs = parsePower();
        if (operator === "*") {
          value *= rhs;
        } else if (operator === "/") {
          value /= rhs;
        } else {
          value %= rhs;
        }
      } else {
        return value;
      }
    }
  };

  const parseExpression = (): number => {
    let value = parseTerm();
    while (true) {
      skipSpaces();
      const operator = peek();
      if (operator === "+" || operator === "-") {
        position += 1;
        const rhs = parseTerm();
        value = operator === "+" ? value + rhs : value - rhs;
      } else {
        return value;
      }
    }
  };

  const result = parseExpression();
  skipSpaces();
  if (position < expression.length) {
    throw new Error(`Unexpected character '${peek()}' at position ${position}.`);
  }
  return result;
}

export const builtinTools: BuiltinTool[] = [
  {
    name: "get_current_time",
    description: "Get the current date and time, optionally in a specific IANA timezone.",
    parameters: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "IANA timezone like 'America/New_York'. Defaults to the local timezone.",
        },
      },
    },
    risk: "read",
    enabledByDefault: true,
    async execute(args) {
      const timezone = typeof args.timezone === "string" && args.timezone ? args.timezone : undefined;
      try {
        const now = new Date();
        const formatted = new Intl.DateTimeFormat("en-US", {
          dateStyle: "full",
          timeStyle: "long",
          timeZone: timezone,
        }).format(now);
        return { content: `${formatted} (ISO: ${now.toISOString()})`, isError: false };
      } catch {
        return { content: `Unknown timezone '${timezone}'.`, isError: true };
      }
    },
  },
  {
    name: "calculate",
    description: "Evaluate an arithmetic expression with + - * / % ^ and parentheses.",
    parameters: {
      type: "object",
      properties: {
        expression: { type: "string", description: "The expression to evaluate, e.g. '(2 + 3) * 4'." },
      },
      required: ["expression"],
    },
    risk: "read",
    enabledByDefault: true,
    async execute(args) {
      const expression = typeof args.expression === "string" ? args.expression : "";
      if (!expression.trim()) {
        return { content: "No expression was provided.", isError: true };
      }
      try {
        const value = evaluateExpression(expression);
        return { content: `${expression} = ${value}`, isError: false };
      } catch (error) {
        return { content: error instanceof Error ? error.message : "Could not evaluate this expression.", isError: true };
      }
    },
  },
  {
    name: "generate_uuid",
    description: "Generate one or more random UUIDs.",
    parameters: {
      type: "object",
      properties: {
        count: { type: "integer", description: "How many UUIDs to generate (1-20). Defaults to 1." },
      },
    },
    risk: "read",
    enabledByDefault: true,
    async execute(args) {
      const count = Math.max(1, Math.min(20, typeof args.count === "number" ? Math.floor(args.count) : 1));
      const uuids = Array.from({ length: count }, () => crypto.randomUUID());
      return { content: uuids.join("\n"), isError: false };
    },
  },
  {
    name: "random_number",
    description: "Generate a random integer between min and max (inclusive).",
    parameters: {
      type: "object",
      properties: {
        min: { type: "integer", description: "Lower bound (inclusive). Defaults to 0." },
        max: { type: "integer", description: "Upper bound (inclusive). Defaults to 100." },
      },
    },
    risk: "read",
    enabledByDefault: true,
    async execute(args) {
      const min = typeof args.min === "number" ? Math.floor(args.min) : 0;
      const max = typeof args.max === "number" ? Math.floor(args.max) : 100;
      if (min > max) {
        return { content: `min (${min}) must be <= max (${max}).`, isError: true };
      }
      const value = min + Math.floor(Math.random() * (max - min + 1));
      return { content: String(value), isError: false };
    },
  },
  {
    name: "fetch_url",
    description: "Fetch the text content of a public http(s) URL. Responses are truncated to 8000 characters.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The http(s) URL to fetch." },
      },
      required: ["url"],
    },
    risk: "network",
    enabledByDefault: false,
    async execute(args) {
      const url = typeof args.url === "string" ? args.url : "";
      if (!/^https?:\/\//i.test(url)) {
        return { content: "Only http(s) URLs can be fetched.", isError: true };
      }
      try {
        const response = await fetch(url);
        if (!response.ok) {
          return { content: `Request failed with status ${response.status}.`, isError: true };
        }
        const text = await response.text();
        return {
          content: text.length > 8000 ? `${text.slice(0, 8000)}\n\n[truncated at 8000 characters]` : text,
          isError: false,
        };
      } catch (error) {
        return { content: error instanceof Error ? error.message : "Could not fetch this URL.", isError: true };
      }
    },
  },
];

export function defaultEnabledBuiltinToolNames(): string[] {
  return builtinTools.filter((tool) => tool.enabledByDefault).map((tool) => tool.name);
}

export function enabledBuiltinTools(enabledNames?: string[]): BuiltinTool[] {
  const enabled = new Set(enabledNames ?? defaultEnabledBuiltinToolNames());
  return builtinTools.filter((tool) => enabled.has(tool.name));
}

export function builtinToolSchema(tool: BuiltinTool): ProviderToolSchema {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
