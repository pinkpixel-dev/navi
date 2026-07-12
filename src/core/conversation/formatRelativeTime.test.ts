import { describe, expect, test } from "vitest";
import { formatRelativeTime } from "./formatRelativeTime";

const now = new Date("2026-07-11T12:00:00.000Z");

describe("formatRelativeTime", () => {
  test("returns 'Just now' for under a minute", () => {
    expect(formatRelativeTime("2026-07-11T11:59:30.000Z", now)).toBe("Just now");
  });

  test("returns minutes for under an hour", () => {
    expect(formatRelativeTime("2026-07-11T11:45:00.000Z", now)).toBe("15m ago");
  });

  test("returns hours for under a day", () => {
    expect(formatRelativeTime("2026-07-11T09:00:00.000Z", now)).toBe("3h ago");
  });

  test("returns days for under a week", () => {
    expect(formatRelativeTime("2026-07-08T12:00:00.000Z", now)).toBe("3d ago");
  });

  test("falls back to a short date beyond a week", () => {
    expect(formatRelativeTime("2026-06-01T12:00:00.000Z", now)).toBe(
      new Date("2026-06-01T12:00:00.000Z").toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    );
  });

  test("treats an unparseable timestamp as 'Just now'", () => {
    expect(formatRelativeTime("not-a-date", now)).toBe("Just now");
  });
});
