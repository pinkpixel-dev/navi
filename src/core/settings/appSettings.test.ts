import { describe, expect, test } from "vitest";
import { defaultAppSettings, loadAppSettings } from "./appSettings";

describe("app settings", () => {
  test("enables rich responses by default", () => {
    expect(defaultAppSettings.richResponsesEnabled).toBe(true);
    expect(loadAppSettings().richResponsesEnabled).toBe(true);
  });
});
