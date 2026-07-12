import { describe, expect, test } from "vitest";
import {
  createLocalStorageProviderConfigDriver,
  createMemoryProviderConfigDriver,
  createProviderConfigRepository,
  type BrowserProviderConfigStore,
  type ProviderConfig,
} from "./providerConfig";

const compatibleProvider: ProviderConfig = {
  id: "provider-1",
  type: "openai-compatible",
  name: "Local compatible",
  baseUrl: "http://localhost:8080/v1",
  defaultModelId: "local-model",
  models: [
    {
      id: "local-model",
      name: "local-model",
      provider: "Local compatible",
      location: "external",
      capabilities: ["tools", "structured-output", "canvas"],
      contextTokens: 128000,
    },
  ],
  hasApiKey: true,
};

function createIsolatedStore(): BrowserProviderConfigStore {
  return {
    configs: [],
    keys: new Map<string, string>(),
  };
}

function createMockStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

describe("provider config repository", () => {
  test("persists provider configs without storing raw api keys", async () => {
    const driver = createMemoryProviderConfigDriver(createIsolatedStore());
    const repository = createProviderConfigRepository(driver);

    await repository.saveProviderConfig({
      ...compatibleProvider,
      apiKey: "secret-key",
    });

    const configs = await repository.loadProviderConfigs();

    expect(configs).toEqual([compatibleProvider]);
    expect(JSON.stringify(configs)).not.toContain("secret-key");
  });

  test("stores provider keys separately from config snapshots", async () => {
    const driver = createMemoryProviderConfigDriver(createIsolatedStore());
    const repository = createProviderConfigRepository(driver);

    await repository.saveProviderApiKey("provider-1", "secret-key");

    expect(await repository.getProviderApiKey("provider-1")).toBe("secret-key");
    expect(await repository.loadProviderConfigs()).toEqual([]);
  });

  test("removes provider configs and saved browser fallback keys", async () => {
    const driver = createMemoryProviderConfigDriver(createIsolatedStore());
    const repository = createProviderConfigRepository(driver);

    await repository.saveProviderConfig({
      ...compatibleProvider,
      apiKey: "secret-key",
    });
    await repository.removeProviderConfig("provider-1");

    expect(await repository.loadProviderConfigs()).toEqual([]);
    expect(await repository.getProviderApiKey("provider-1")).toBeNull();
  });

  test("persists browser fallback provider configs and keys across driver instances", async () => {
    const storage = createMockStorage();
    const firstRepository = createProviderConfigRepository(createLocalStorageProviderConfigDriver(storage));

    await firstRepository.saveProviderConfig({
      ...compatibleProvider,
      apiKey: "secret-key",
    });

    const secondRepository = createProviderConfigRepository(createLocalStorageProviderConfigDriver(storage));

    expect(await secondRepository.loadProviderConfigs()).toEqual([compatibleProvider]);
    expect(await secondRepository.getProviderApiKey("provider-1")).toBe("secret-key");
  });
});
