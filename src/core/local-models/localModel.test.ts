import { describe, expect, test } from "vitest";
import { createMemoryLocalModelDriver } from "./localModel";

describe("local model driver", () => {
  test("imports, lists, and removes local models", async () => {
    const driver = createMemoryLocalModelDriver();

    const imported = await driver.importLocalModel("/models/test-model.gguf");
    expect(imported.fileName).toBe("test-model.gguf");
    expect(imported.filePath).toBe("/models/test-model.gguf");
    expect(imported.parseStatus).toBe("unreadable");

    const models = await driver.loadLocalModels();
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe(imported.id);

    await driver.removeLocalModel(imported.id);
    expect(await driver.loadLocalModels()).toEqual([]);
  });

  test("derives a file name for both forward and backward slash paths", async () => {
    const driver = createMemoryLocalModelDriver();

    const unixImport = await driver.importLocalModel("/models/nested/unix-model.gguf");
    const windowsImport = await driver.importLocalModel("C:\\models\\windows-model.gguf");

    expect(unixImport.fileName).toBe("unix-model.gguf");
    expect(windowsImport.fileName).toBe("windows-model.gguf");
  });
});
