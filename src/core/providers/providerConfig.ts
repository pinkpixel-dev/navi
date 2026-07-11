import { invoke } from "@tauri-apps/api/core";
import type { ProviderModel } from "./types";

export type ProviderType = "openai-compatible" | "openai" | "ollama";

export interface ProviderConfig {
  id: string;
  type: ProviderType;
  name: string;
  baseUrl?: string;
  defaultModelId: string;
  models: ProviderModel[];
  hasApiKey: boolean;
  apiKey?: string;
}

export interface ProviderConfigDriver {
  loadProviderConfigs: () => Promise<ProviderConfig[]>;
  saveProviderConfig: (config: ProviderConfig) => Promise<void>;
  saveProviderApiKey: (providerId: string, apiKey: string) => Promise<void>;
  getProviderApiKey: (providerId: string) => Promise<string | null>;
}

export interface ProviderConfigRepository {
  loadProviderConfigs: () => Promise<ProviderConfig[]>;
  saveProviderConfig: (config: ProviderConfig) => Promise<void>;
  saveProviderApiKey: (providerId: string, apiKey: string) => Promise<void>;
  getProviderApiKey: (providerId: string) => Promise<string | null>;
}

export interface BrowserProviderConfigStore {
  configs: ProviderConfig[];
  keys: Map<string, string>;
}

const browserProviderConfigStoreKey = "__NAVI_PROVIDER_CONFIG_STORE__";
const browserProviderConfigStorageKey = "navi.providerConfigStore";

interface SerializedBrowserProviderConfigStore {
  configs?: ProviderConfig[];
  keys?: Record<string, string>;
}

function getBrowserProviderConfigStore(): BrowserProviderConfigStore {
  const globalStore = globalThis as typeof globalThis & {
    [browserProviderConfigStoreKey]?: BrowserProviderConfigStore;
  };

  globalStore[browserProviderConfigStoreKey] ??= {
    configs: [],
    keys: new Map<string, string>(),
  };

  return globalStore[browserProviderConfigStoreKey];
}

function readBrowserProviderConfigStore(storage: Storage): BrowserProviderConfigStore {
  const rawValue = storage.getItem(browserProviderConfigStorageKey);
  if (!rawValue) {
    return getBrowserProviderConfigStore();
  }

  try {
    const parsed = JSON.parse(rawValue) as SerializedBrowserProviderConfigStore;
    return {
      configs: parsed.configs ?? [],
      keys: new Map(Object.entries(parsed.keys ?? {})),
    };
  } catch {
    return getBrowserProviderConfigStore();
  }
}

function writeBrowserProviderConfigStore(storage: Storage, store: BrowserProviderConfigStore): void {
  storage.setItem(
    browserProviderConfigStorageKey,
    JSON.stringify({
      configs: store.configs,
      keys: Object.fromEntries(store.keys),
    }),
  );
}

function sanitizeProviderConfig(config: ProviderConfig): ProviderConfig {
  const { apiKey: _apiKey, ...safeConfig } = config;
  return {
    ...safeConfig,
    hasApiKey: Boolean(config.hasApiKey || config.apiKey),
  };
}

export function createProviderConfigRepository(driver: ProviderConfigDriver): ProviderConfigRepository {
  return {
    loadProviderConfigs: () => driver.loadProviderConfigs(),
    async saveProviderConfig(config) {
      await driver.saveProviderConfig(sanitizeProviderConfig(config));
      if (config.apiKey) {
        await driver.saveProviderApiKey(config.id, config.apiKey);
      }
    },
    saveProviderApiKey: (providerId, apiKey) => driver.saveProviderApiKey(providerId, apiKey),
    getProviderApiKey: (providerId) => driver.getProviderApiKey(providerId),
  };
}

export function createMemoryProviderConfigDriver(store: BrowserProviderConfigStore = getBrowserProviderConfigStore()): ProviderConfigDriver {
  return {
    async loadProviderConfigs() {
      return [...store.configs];
    },
    async saveProviderConfig(config) {
      store.configs = [
        sanitizeProviderConfig(config),
        ...store.configs.filter((currentConfig) => currentConfig.id !== config.id),
      ];
    },
    async saveProviderApiKey(providerId, apiKey) {
      store.keys.set(providerId, apiKey);
    },
    async getProviderApiKey(providerId) {
      return store.keys.get(providerId) ?? null;
    },
  };
}

export function createLocalStorageProviderConfigDriver(storage: Storage): ProviderConfigDriver {
  let store = readBrowserProviderConfigStore(storage);

  return {
    async loadProviderConfigs() {
      store = readBrowserProviderConfigStore(storage);
      return [...store.configs];
    },
    async saveProviderConfig(config) {
      store.configs = [
        sanitizeProviderConfig(config),
        ...store.configs.filter((currentConfig) => currentConfig.id !== config.id),
      ];
      writeBrowserProviderConfigStore(storage, store);
    },
    async saveProviderApiKey(providerId, apiKey) {
      store.keys.set(providerId, apiKey);
      writeBrowserProviderConfigStore(storage, store);
    },
    async getProviderApiKey(providerId) {
      store = readBrowserProviderConfigStore(storage);
      return store.keys.get(providerId) ?? null;
    },
  };
}

export function createTauriProviderConfigDriver(): ProviderConfigDriver {
  return {
    loadProviderConfigs: () => invoke<ProviderConfig[]>("load_provider_configs"),
    saveProviderConfig: (config) => invoke<void>("save_provider_config", { config: sanitizeProviderConfig(config) }),
    saveProviderApiKey: (providerId, apiKey) => invoke<void>("save_provider_api_key", { providerId, apiKey }),
    getProviderApiKey: (providerId) => invoke<string | null>("get_provider_api_key", { providerId }),
  };
}

export function createDefaultProviderConfigRepository(): ProviderConfigRepository {
  const isTauri = "__TAURI_INTERNALS__" in window;
  const driver = isTauri
    ? createTauriProviderConfigDriver()
    : "localStorage" in window
    ? createLocalStorageProviderConfigDriver(window.localStorage)
    : createMemoryProviderConfigDriver();

  return createProviderConfigRepository(driver);
}
