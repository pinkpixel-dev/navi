import { describe, expect, test } from "vitest";
import { emptyChatGreetings, pickEmptyChatGreeting } from "./emptyChatGreeting";

describe("empty chat greeting", () => {
  test("uses the display name when there is one", () => {
    const greeting = pickEmptyChatGreeting("conversation-1", "sizzlebop");

    expect(greeting).toContain("sizzlebop");
    expect(greeting).not.toContain("{name}");
  });

  test("falls back to a phrase that stands on its own without a name", () => {
    for (const seed of ["a", "b", "c", "conversation-1", "conversation-2"]) {
      for (const displayName of [undefined, "", "   "]) {
        const greeting = pickEmptyChatGreeting(seed, displayName);

        expect(greeting).not.toContain("{name}");
        expect(emptyChatGreetings.some((entry) => entry.withoutName === greeting)).toBe(true);
      }
    }
  });

  test("trims a padded display name", () => {
    expect(pickEmptyChatGreeting("conversation-1", "  sizzlebop  ")).toBe(
      pickEmptyChatGreeting("conversation-1", "sizzlebop"),
    );
  });

  test("keeps the same greeting for the same conversation", () => {
    expect(pickEmptyChatGreeting("conversation-1", "sizzlebop")).toBe(
      pickEmptyChatGreeting("conversation-1", "sizzlebop"),
    );
  });

  test("spreads conversation ids across every greeting", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 500; index += 1) {
      seen.add(pickEmptyChatGreeting(`conversation-${index}`));
    }

    expect(seen.size).toBe(emptyChatGreetings.length);
  });
});
