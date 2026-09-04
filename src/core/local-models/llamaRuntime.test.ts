import { describe, expect, test } from "vitest";
import { createUnsupportedLlamaRuntimeDriver, unknownRuntimeUpdateInfo } from "./llamaRuntime";

describe("llama runtime driver outside Tauri", () => {
  test("reports the runtime as not downloaded and idle", async () => {
    const driver = createUnsupportedLlamaRuntimeDriver();

    expect(await driver.isRuntimeDownloaded()).toBe(false);
    expect(await driver.getRuntimeStatus()).toEqual({ state: "idle", port: null, modelId: null, message: null });
  });

  test("rejects attempts to download or start the runtime", async () => {
    const driver = createUnsupportedLlamaRuntimeDriver();

    await expect(driver.downloadRuntime()).rejects.toThrow("only available in the desktop app");
    await expect(driver.updateRuntime()).rejects.toThrow("only available in the desktop app");
    await expect(driver.startRuntime("model-1", "/models/model-1.gguf")).rejects.toThrow(
      "only available in the desktop app",
    );
  });

  test("never offers a runtime update", async () => {
    const driver = createUnsupportedLlamaRuntimeDriver();

    expect(await driver.checkRuntimeUpdate()).toEqual(unknownRuntimeUpdateInfo);
    expect(unknownRuntimeUpdateInfo.updateAvailable).toBe(false);
  });
});
