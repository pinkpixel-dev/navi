import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { FolderOpen, KeyRound, Pencil, Play, Plug, Plus, RefreshCw, Save, Square, Trash2, X } from "lucide-react";
import { builtinTools, defaultEnabledBuiltinToolNames } from "../core/tools/builtinTools";
import { open } from "@tauri-apps/plugin-dialog";
import { createProviderFromConfig } from "../core/providers/createProvider";
import {
  createDefaultProviderConfigRepository,
  type ProviderConfig,
  type ProviderType,
} from "../core/providers/providerConfig";
import { createDefaultLocalModelRepository, type LocalModel } from "../core/local-models/localModel";
import {
  createDefaultLlamaRuntimeDriver,
  type LocalRuntimeAcceleration,
  type LocalRuntimeStatus,
} from "../core/local-models/llamaRuntime";
import {
  createDefaultMcpServerDriver,
  type McpServerConfig,
  type McpServerStatus,
  type McpTransport,
} from "../core/mcp/mcpServer";
import type { AppSettings, SubmitShortcut } from "../core/settings/appSettings";
import { confirmDestructiveAction } from "./confirmDialog";

interface SettingsPanelProps {
  providerConfigs: ProviderConfig[];
  onProviderConfigsChange: (providerConfigs: ProviderConfig[]) => void;
  localModels: LocalModel[];
  onLocalModelsChange: (localModels: LocalModel[]) => void;
  mcpServers: McpServerConfig[];
  onMcpServersChange: (mcpServers: McpServerConfig[]) => void;
  mcpConnections: Record<string, McpServerStatus>;
  onMcpConnectionsChange: (mcpConnections: Record<string, McpServerStatus>) => void;
  appSettings: AppSettings;
  onAppSettingsChange: (appSettings: AppSettings) => void;
  onClose: () => void;
}

const providerConfigRepository = createDefaultProviderConfigRepository();
const localModelRepository = createDefaultLocalModelRepository();
const llamaRuntimeDriver = createDefaultLlamaRuntimeDriver();
const mcpServerDriver = createDefaultMcpServerDriver();
const isTauri = "__TAURI_INTERNALS__" in window;
const idleRuntimeStatus: LocalRuntimeStatus = { state: "idle", port: null, modelId: null, message: null };

function createDraftMcpServer(): McpServerConfig {
  return {
    id: crypto.randomUUID(),
    name: "New server",
    enabled: true,
    transport: "stdio",
    command: "",
    url: "",
  };
}

function parseArgsText(text: string): string[] {
  return text
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseKeyValueLines(text: string, separator: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const index = trimmed.indexOf(separator);
    if (index === -1) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + separator.length).trim();
    if (key) {
      result[key] = value;
    }
  }
  return result;
}

function formatKeyValueLines(record: Record<string, string> | undefined, separator: string): string {
  return Object.entries(record ?? {})
    .map(([key, value]) => `${key}${separator}${value}`)
    .join("\n");
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }
  if (bytes >= 1024 ** 2) {
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function createDraftProvider(): ProviderConfig {
  return {
    id: crypto.randomUUID(),
    type: "openai-compatible",
    name: "Compatible endpoint",
    baseUrl: "http://localhost:8080/v1",
    defaultModelId: "",
    models: [],
    hasApiKey: false,
  };
}

function defaultProviderNameForType(type: ProviderType): string {
  switch (type) {
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "gemini":
      return "Google Gemini";
    case "openrouter":
      return "OpenRouter";
    case "ollama":
      return "Ollama";
    case "lmstudio":
      return "LM Studio";
    default:
      return "Compatible endpoint";
  }
}

function isDefaultProviderName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return ["compatible endpoint", "openai", "anthropic", "google gemini", "openrouter", "ollama", "lm studio"].includes(
    normalized,
  );
}

const providerTypesWithRequiredKey = new Set<ProviderType>(["openai", "anthropic", "gemini", "openrouter"]);
const providerTypesWithBaseUrl = new Set<ProviderType>(["openai-compatible", "ollama", "lmstudio"]);

function defaultBaseUrlForType(type: ProviderType): string | undefined {
  switch (type) {
    case "openai-compatible":
      return "http://localhost:8080/v1";
    case "ollama":
      return "http://localhost:11434/v1";
    case "lmstudio":
      return "http://localhost:1234/v1";
    default:
      return undefined;
  }
}

function providerEndpointLabel(provider: ProviderConfig): string {
  switch (provider.type) {
    case "openai":
      return "api.openai.com";
    case "anthropic":
      return "api.anthropic.com";
    case "gemini":
      return "generativelanguage.googleapis.com";
    case "openrouter":
      return "openrouter.ai";
    case "ollama":
      return `${provider.baseUrl ?? "http://localhost:11434/v1"} (Ollama)`;
    case "lmstudio":
      return `${provider.baseUrl ?? "http://localhost:1234/v1"} (LM Studio)`;
    default:
      return provider.baseUrl ?? "No endpoint URL";
  }
}

export function SettingsPanel({
  providerConfigs,
  onProviderConfigsChange,
  localModels,
  onLocalModelsChange,
  mcpServers,
  onMcpServersChange,
  mcpConnections,
  onMcpConnectionsChange,
  appSettings,
  onAppSettingsChange,
  onClose,
}: SettingsPanelProps) {
  const [draftProvider, setDraftProvider] = useState<ProviderConfig>(providerConfigs[0] ?? createDraftProvider());
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState("Provider config is local to this app.");
  const [modelFilterText, setModelFilterText] = useState("");
  const [localModelStatus, setLocalModelStatus] = useState("Import a .gguf file to make it selectable in chat.");
  const [runtimeStatus, setRuntimeStatus] = useState<LocalRuntimeStatus>(idleRuntimeStatus);
  const [isRuntimeBusy, setIsRuntimeBusy] = useState(false);
  const [draftMcpServer, setDraftMcpServer] = useState<McpServerConfig>(createDraftMcpServer());
  const [isMcpModalOpen, setIsMcpModalOpen] = useState(false);
  const [mcpArgsText, setMcpArgsText] = useState("");
  const [mcpEnvText, setMcpEnvText] = useState("");
  const [mcpHeadersText, setMcpHeadersText] = useState("");
  const [mcpStatus, setMcpStatus] = useState("Add a server to see its tools.");
  const [mcpTestResult, setMcpTestResult] = useState<McpServerStatus | null>(null);

  useEffect(() => {
    setDraftProvider((current) => providerConfigs.find((config) => config.id === current.id) ?? providerConfigs[0] ?? createDraftProvider());
  }, [providerConfigs]);

  useEffect(() => {
    if (!isTauri) {
      return;
    }
    llamaRuntimeDriver.getRuntimeStatus().then(setRuntimeStatus).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isTauri || !isRuntimeBusy) {
      return;
    }
    const interval = window.setInterval(() => {
      llamaRuntimeDriver.getRuntimeStatus().then(setRuntimeStatus).catch(() => {});
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isRuntimeBusy]);

  const userAvatarInputRef = useRef<HTMLInputElement>(null);
  const assistantAvatarInputRef = useRef<HTMLInputElement>(null);

  const updateDraft = (patch: Partial<ProviderConfig>) => {
    setDraftProvider((current) => ({ ...current, ...patch }));
  };

  const enabledToolNames = appSettings.enabledBuiltinTools ?? defaultEnabledBuiltinToolNames();

  const handleToggleBuiltinTool = (name: string) => {
    const next = enabledToolNames.includes(name)
      ? enabledToolNames.filter((toolName) => toolName !== name)
      : [...enabledToolNames, name];
    onAppSettingsChange({ ...appSettings, enabledBuiltinTools: next });
  };

  const handleAvatarUpload = (role: "user" | "assistant") => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = String(reader.result ?? "");
      onAppSettingsChange(
        role === "user" ? { ...appSettings, userAvatar: dataUri } : { ...appSettings, assistantAvatar: dataUri },
      );
    };
    reader.readAsDataURL(file);
  };

  const handleToggleModelEnabled = (modelId: string) => {
    setDraftProvider((current) => {
      const allIds = current.models.map((model) => model.id);
      const currentlyEnabled = current.enabledModelIds ?? allIds;
      const nextEnabled = currentlyEnabled.includes(modelId)
        ? currentlyEnabled.filter((id) => id !== modelId)
        : [...currentlyEnabled, modelId];
      return { ...current, enabledModelIds: nextEnabled };
    });
  };

  const handleSetAllModelsEnabled = (enabled: boolean) => {
    setDraftProvider((current) => ({
      ...current,
      enabledModelIds: enabled ? undefined : [],
    }));
  };

  const handleFetchModels = async () => {
    if (draftProvider.type === "openai-compatible" && !draftProvider.baseUrl) {
      setStatus("Add a base URL before fetching models.");
      return;
    }

    const savedKey = apiKey || (await providerConfigRepository.getProviderApiKey(draftProvider.id).catch(() => null));
    const provider = createProviderFromConfig(draftProvider, {
      apiKey: savedKey,
      model: draftProvider.defaultModelId || "model",
    });

    if (!provider) {
      setStatus("Add an API key before fetching models.");
      return;
    }

    try {
      const models = await provider.listModels?.();
      if (!models?.length) {
        setStatus("No models were returned by this endpoint.");
        return;
      }

      updateDraft({ models });
      setStatus(`Fetched ${models.length} model${models.length === 1 ? "" : "s"}. Uncheck any you don't want in the chat model picker below.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not fetch models.");
    }
  };

  const handleProviderTypeChange = (nextType: ProviderType) => {
    const nextBaseUrl = providerTypesWithBaseUrl.has(nextType)
      ? draftProvider.baseUrl || defaultBaseUrlForType(nextType)
      : undefined;
    const nextName =
      !draftProvider.name.trim() || isDefaultProviderName(draftProvider.name)
        ? defaultProviderNameForType(nextType)
        : draftProvider.name;
    updateDraft({ type: nextType, baseUrl: nextBaseUrl, name: nextName });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const savedProvider: ProviderConfig = {
      ...draftProvider,
      hasApiKey: Boolean(apiKey || draftProvider.hasApiKey),
      apiKey: apiKey || undefined,
    };

    await providerConfigRepository.saveProviderConfig(savedProvider);
    const nextConfigs = [
      { ...savedProvider, apiKey: undefined },
      ...providerConfigs.filter((config) => config.id !== savedProvider.id),
    ];
    onProviderConfigsChange(nextConfigs);
    setApiKey("");
    setStatus("Provider saved.");
    setIsProviderModalOpen(false);
  };

  const handleSelectProvider = (providerId: string) => {
    if (providerId === "new") {
      setDraftProvider(createDraftProvider());
      setApiKey("");
      setStatus("New provider draft.");
      setIsProviderModalOpen(true);
      return;
    }

    const nextProvider = providerConfigs.find((config) => config.id === providerId);
    if (nextProvider) {
      setDraftProvider(nextProvider);
      setApiKey("");
      setStatus(nextProvider.hasApiKey ? "Saved key available." : "No key saved for this provider.");
    }
  };

  const handleRemoveProvider = async (provider: ProviderConfig) => {
    const confirmed = await confirmDestructiveAction(`Delete provider "${provider.name}"? This removes it from Navi.`);
    if (!confirmed) {
      return;
    }
    await providerConfigRepository.removeProviderConfig(provider.id);
    onProviderConfigsChange(providerConfigs.filter((config) => config.id !== provider.id));
    if (draftProvider.id === provider.id) {
      setDraftProvider(providerConfigs.find((config) => config.id !== provider.id) ?? createDraftProvider());
    }
    setStatus("Provider removed.");
  };

  const handleImportLocalModel = async () => {
    try {
      const selectedPath = await open({
        multiple: false,
        filters: [{ name: "GGUF model", extensions: ["gguf"] }],
      });

      if (!selectedPath || Array.isArray(selectedPath)) {
        return;
      }

      setLocalModelStatus("Reading model metadata...");
      const imported = await localModelRepository.importLocalModel(selectedPath);
      onLocalModelsChange([imported, ...localModels]);
      setLocalModelStatus(
        imported.parseStatus === "parsed"
          ? `Imported ${imported.fileName}.`
          : `Imported ${imported.fileName}, but its GGUF metadata could not be fully read.`,
      );
    } catch (error) {
      setLocalModelStatus(error instanceof Error ? error.message : "Could not import this model.");
    }
  };

  const handleRemoveLocalModel = async (id: string) => {
    await localModelRepository.removeLocalModel(id);
    onLocalModelsChange(localModels.filter((model) => model.id !== id));
    setLocalModelStatus("Model removed.");
  };

  const handleStartLocalModel = async (model: LocalModel) => {
    setIsRuntimeBusy(true);
    try {
      const acceleration = appSettings.localRuntimeAcceleration ?? "auto";
      const gpuLayers = appSettings.localRuntimeGpuLayers ?? 99;
      const alreadyDownloaded = await llamaRuntimeDriver.isRuntimeDownloaded(appSettings.customLlamaServerPath, acceleration);
      if (!alreadyDownloaded) {
        const confirmed = await confirmDestructiveAction(
          `Download the llama.cpp ${acceleration === "auto" ? "accelerated" : acceleration.toUpperCase()} runtime? This only happens once.`,
        );
        if (!confirmed) {
          return;
        }
        setLocalModelStatus("Downloading llama.cpp runtime...");
        await llamaRuntimeDriver.downloadRuntime(acceleration);
      }

      setLocalModelStatus(`Starting ${model.fileName} — this can take a while for large models...`);
      const nextStatus = await llamaRuntimeDriver.startRuntime(
        model.id,
        model.filePath,
        appSettings.customLlamaServerPath,
        acceleration,
        gpuLayers,
      );
      setRuntimeStatus(nextStatus);
      setLocalModelStatus(
        nextStatus.state === "ready"
          ? `${model.fileName} is running on port ${nextStatus.port}.`
          : nextStatus.message ?? "Could not start the local model.",
      );
    } catch (error) {
      setLocalModelStatus(error instanceof Error ? error.message : "Could not start the local model.");
    } finally {
      setIsRuntimeBusy(false);
    }
  };

  const handleStopLocalModel = async () => {
    await llamaRuntimeDriver.stopRuntime();
    setRuntimeStatus(idleRuntimeStatus);
    setLocalModelStatus("Local model stopped.");
  };

  const buildMcpConfigFromDraft = (): McpServerConfig => ({
    ...draftMcpServer,
    args: draftMcpServer.transport === "stdio" ? parseArgsText(mcpArgsText) : undefined,
    env: draftMcpServer.transport === "stdio" ? parseKeyValueLines(mcpEnvText, "=") : undefined,
    headers: draftMcpServer.transport === "http" ? parseKeyValueLines(mcpHeadersText, ":") : undefined,
  });

  const handleTestMcpConnection = async () => {
    setMcpStatus("Testing connection...");
    setMcpTestResult(null);
    try {
      const config = buildMcpConfigFromDraft();
      const result = await mcpServerDriver.testConnection(config);
      setMcpTestResult(result);
      setMcpStatus(`Connected. Found ${result.tools.length} tool${result.tools.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setMcpStatus(error instanceof Error ? error.message : "Could not connect to this server.");
    }
  };

  const handleSaveMcpServer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const config = buildMcpConfigFromDraft();
    await mcpServerDriver.saveServer(config);
    onMcpServersChange([config, ...mcpServers.filter((server) => server.id !== config.id)]);
    setDraftMcpServer(config);
    setMcpStatus("Server saved.");
    setIsMcpModalOpen(false);
  };

  const handleSelectMcpServer = (id: string) => {
    if (id === "new") {
      setDraftMcpServer(createDraftMcpServer());
      setMcpArgsText("");
      setMcpEnvText("");
      setMcpHeadersText("");
      setMcpTestResult(null);
      setMcpStatus("New server draft.");
      setIsMcpModalOpen(true);
      return;
    }

    const server = mcpServers.find((item) => item.id === id);
    if (server) {
      setDraftMcpServer(server);
      setMcpArgsText((server.args ?? []).join(" "));
      setMcpEnvText(formatKeyValueLines(server.env, "="));
      setMcpHeadersText(formatKeyValueLines(server.headers, ": "));
      setMcpTestResult(null);
      setMcpStatus(mcpConnections[id] ? "Connected." : "Not connected.");
      setIsMcpModalOpen(true);
    }
  };

  const handleRemoveMcpServer = async (id: string) => {
    await mcpServerDriver.disconnectServer(id).catch(() => {});
    await mcpServerDriver.removeServer(id);
    onMcpServersChange(mcpServers.filter((server) => server.id !== id));
    const nextConnections = { ...mcpConnections };
    delete nextConnections[id];
    onMcpConnectionsChange(nextConnections);
    setMcpStatus("Server removed.");
  };

  const handleConnectMcpServer = async (server: McpServerConfig) => {
    setMcpStatus(`Connecting to ${server.name}...`);
    try {
      const result = await mcpServerDriver.connectServer(server);
      onMcpConnectionsChange({ ...mcpConnections, [server.id]: result });
      setMcpStatus(`${server.name}: ${result.tools.length} tool${result.tools.length === 1 ? "" : "s"} available.`);
    } catch (error) {
      setMcpStatus(error instanceof Error ? error.message : `Could not connect to ${server.name}.`);
    }
  };

  const handleDisconnectMcpServer = async (server: McpServerConfig) => {
    await mcpServerDriver.disconnectServer(server.id);
    const nextConnections = { ...mcpConnections };
    delete nextConnections[server.id];
    onMcpConnectionsChange(nextConnections);
    setMcpStatus(`${server.name} disconnected.`);
  };

  return (
    <div className="settings-scrim">
      <section className="settings-panel" aria-label="Settings">
        <header>
          <div>
            <h2>Settings</h2>
            <p>Manage compatible providers and model discovery.</p>
          </div>
          <button type="button" aria-label="Close settings" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="settings-grid">
          <div className="settings-section">
            <div className="settings-section-header">
              <h3>Connected Providers</h3>
              <button type="button" onClick={() => handleSelectProvider("new")}>
                <Plus size={15} />
                Add New Provider
              </button>
            </div>
            <div className="settings-card-list">
              {providerConfigs.length ? (
                providerConfigs.map((provider) => (
                  <div
                    className={
                      provider.id === draftProvider.id
                        ? "settings-card settings-clickable-card active"
                        : "settings-card settings-clickable-card"
                    }
                    key={provider.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectProvider(provider.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleSelectProvider(provider.id);
                      }
                    }}
                  >
                    <strong>{provider.name}</strong>
                    <span>
                      {provider.hasApiKey ? "saved key" : "key optional"} / {providerEndpointLabel(provider)}
                    </span>
                    <div className="settings-card-actions">
                      <button
                        type="button"
                        aria-label={`Edit ${provider.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleSelectProvider(provider.id);
                          setIsProviderModalOpen(true);
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${provider.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleRemoveProvider(provider);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="settings-card">
                  <strong>No providers saved</strong>
                  <span>Add a provider to start chatting.</span>
                </div>
              )}
            </div>
          </div>
          {isProviderModalOpen ? (
            <div className="settings-modal-scrim" role="dialog" aria-modal="true" aria-label="Provider setup">
              <form className="settings-form settings-modal" onSubmit={handleSubmit}>
                <header>
                  <div>
                    <h3>Provider Setup</h3>
                    <p>Add keys, fetch models, and choose which models appear in chat.</p>
                  </div>
                  <button type="button" aria-label="Close provider setup" onClick={() => setIsProviderModalOpen(false)}>
                    <X size={16} />
                  </button>
                </header>
            <label>
              <span>Editing</span>
              <select value={providerConfigs.some((config) => config.id === draftProvider.id) ? draftProvider.id : "new"} onChange={(event) => handleSelectProvider(event.target.value)}>
                <option value="new">New provider</option>
                {providerConfigs.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Type</span>
              <select
                value={draftProvider.type}
                onChange={(event) => {
                  handleProviderTypeChange(event.target.value as ProviderType);
                }}
              >
                <option value="openai-compatible">OpenAI-compatible</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Google Gemini</option>
                <option value="openrouter">OpenRouter</option>
                <option value="ollama">Ollama</option>
                <option value="lmstudio">LM Studio</option>
              </select>
            </label>
            <label>
              <span>Name</span>
              <input
                value={draftProvider.name}
                onChange={(event) => updateDraft({ name: event.target.value })}
              />
            </label>
            {providerTypesWithBaseUrl.has(draftProvider.type) ? (
              <label>
                <span>Base URL</span>
                <input
                  value={draftProvider.baseUrl ?? ""}
                  onChange={(event) => updateDraft({ baseUrl: event.target.value })}
                />
              </label>
            ) : null}
            <label>
              <span>API key{providerTypesWithRequiredKey.has(draftProvider.type) ? "" : " (optional)"}</span>
              <input
                type="password"
                value={apiKey}
                placeholder={
                  draftProvider.hasApiKey
                    ? "Saved key available"
                    : providerTypesWithRequiredKey.has(draftProvider.type)
                    ? `Required for ${providerEndpointLabel(draftProvider)}`
                    : "No key required for some endpoints"
                }
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
            <label>
              <span>Manual model ID (only used if you don't fetch a list)</span>
              <input
                value={draftProvider.defaultModelId}
                onChange={(event) => updateDraft({ defaultModelId: event.target.value })}
                placeholder="e.g. gpt-4o-mini"
              />
            </label>
            <div className="settings-actions">
              <button type="button" onClick={handleFetchModels}>
                <RefreshCw size={15} />
                Fetch models
              </button>
              <button type="submit">
                <Save size={15} />
                Save provider
              </button>
              <button type="button" onClick={() => handleSelectProvider("new")}>
                <Plus size={15} />
                New provider
              </button>
            </div>
            <p className="settings-note">
              <KeyRound size={14} />
              {status}
            </p>
            {draftProvider.models.length ? (
              <>
                <label>
                  <span>Filter models shown in the chat picker</span>
                  <input
                    value={modelFilterText}
                    onChange={(event) => setModelFilterText(event.target.value)}
                    placeholder="Search fetched models..."
                  />
                </label>
                <div className="settings-actions">
                  <button type="button" onClick={() => handleSetAllModelsEnabled(true)}>
                    Show all
                  </button>
                  <button type="button" onClick={() => handleSetAllModelsEnabled(false)}>
                    Hide all
                  </button>
                </div>
                <div className="settings-model-list">
                  {draftProvider.models
                    .filter((model) => model.name.toLowerCase().includes(modelFilterText.toLowerCase()))
                    .map((model) => {
                      const isEnabled = !draftProvider.enabledModelIds || draftProvider.enabledModelIds.includes(model.id);
                      return (
                        <label className="settings-model-checkbox" key={model.id}>
                          <input type="checkbox" checked={isEnabled} onChange={() => handleToggleModelEnabled(model.id)} />
                          <span>{model.name}</span>
                        </label>
                      );
                    })}
                </div>
              </>
            ) : null}
              </form>
            </div>
          ) : null}
          <div className="settings-form settings-general">
            <h3>General</h3>
            <label>
              <span>Send message with</span>
              <select
                value={appSettings.submitShortcut}
                onChange={(event) =>
                  onAppSettingsChange({
                    ...appSettings,
                    submitShortcut: event.target.value as SubmitShortcut,
                  })
                }
              >
                <option value="enter">Enter (Shift+Enter for a new line)</option>
                <option value="shift-enter">Shift+Enter (Enter for a new line)</option>
              </select>
            </label>
          </div>
          <div className="settings-form settings-avatars">
            <h3>Avatars</h3>
            <p className="settings-note">Shown next to messages. PNG, JPEG, GIF, or WebP.</p>
            <div className="settings-avatar-row">
              <img className="settings-avatar" src={appSettings.userAvatar ?? "/user.png"} alt="User avatar" />
              <span>You</span>
              <input
                ref={userAvatarInputRef}
                type="file"
                hidden
                accept="image/png,image/jpeg,image/gif,image/webp"
                onChange={handleAvatarUpload("user")}
              />
              <button type="button" onClick={() => userAvatarInputRef.current?.click()}>
                Change
              </button>
              {appSettings.userAvatar ? (
                <button type="button" onClick={() => onAppSettingsChange({ ...appSettings, userAvatar: undefined })}>
                  Reset
                </button>
              ) : null}
            </div>
            <div className="settings-avatar-row">
              <img
                className="settings-avatar"
                src={appSettings.assistantAvatar ?? "/assistant.png"}
                alt="Assistant avatar"
              />
              <span>Assistant</span>
              <input
                ref={assistantAvatarInputRef}
                type="file"
                hidden
                accept="image/png,image/jpeg,image/gif,image/webp"
                onChange={handleAvatarUpload("assistant")}
              />
              <button type="button" onClick={() => assistantAvatarInputRef.current?.click()}>
                Change
              </button>
              {appSettings.assistantAvatar ? (
                <button
                  type="button"
                  onClick={() => onAppSettingsChange({ ...appSettings, assistantAvatar: undefined })}
                >
                  Reset
                </button>
              ) : null}
            </div>
          </div>
          {isTauri ? (
            <div className="settings-form settings-local-models">
              <h3>Local Models</h3>
              <p className="settings-note">
                Local models stay selectable in chat alongside any providers you configure below — you never need to
                remove one to use the other.
              </p>
              <div className="settings-actions">
                <button type="button" onClick={handleImportLocalModel}>
                  <FolderOpen size={15} />
                  Import GGUF model
                </button>
              </div>
              <label>
                <span>Custom llama-server path (optional)</span>
                <input
                  value={appSettings.customLlamaServerPath ?? ""}
                  onChange={(event) =>
                    onAppSettingsChange({ ...appSettings, customLlamaServerPath: event.target.value || undefined })
                  }
                  placeholder="Skips the download if you already have llama-server installed"
                />
              </label>
              <label>
                <span>llama.cpp acceleration</span>
                <select
                  value={appSettings.localRuntimeAcceleration ?? "auto"}
                  onChange={(event) =>
                    onAppSettingsChange({
                      ...appSettings,
                      localRuntimeAcceleration: event.target.value as LocalRuntimeAcceleration,
                    })
                  }
                >
                  <option value="auto">Auto (CUDA on Windows, Vulkan on Linux)</option>
                  <option value="cuda">CUDA / NVIDIA</option>
                  <option value="vulkan">Vulkan</option>
                  <option value="rocm">ROCm / AMD</option>
                  <option value="sycl">SYCL / Intel</option>
                  <option value="cpu">CPU only</option>
                </select>
              </label>
              <label>
                <span>GPU layers</span>
                <input
                  type="number"
                  min={0}
                  max={999}
                  value={appSettings.localRuntimeGpuLayers ?? 99}
                  onChange={(event) =>
                    onAppSettingsChange({
                      ...appSettings,
                      localRuntimeGpuLayers: Number(event.target.value || 0),
                    })
                  }
                />
              </label>
              <p className="settings-note">
                Linux Auto uses the Vulkan build from llama.cpp releases. Use a custom CUDA binary path for Linux CUDA.
              </p>
              <p className="settings-note">
                <KeyRound size={14} />
                {localModelStatus}
              </p>
              {localModels.length ? (
                localModels.map((model) => {
                  const isRunning = runtimeStatus.state === "ready" && runtimeStatus.modelId === model.id;
                  return (
                    <div className="settings-row" key={model.id}>
                      <strong>{model.fileName}</strong>
                      <span>
                        {model.parseStatus === "parsed"
                          ? [model.architecture, model.quantization, model.contextLength ? `${model.contextLength.toLocaleString()} ctx` : null]
                              .filter(Boolean)
                              .join(" / ")
                          : "GGUF metadata unavailable"}
                        {" · "}
                        {formatFileSize(model.fileSizeBytes)}
                        {isRunning ? ` · running on port ${runtimeStatus.port}` : ""}
                      </span>
                      {isRunning ? (
                        <button type="button" aria-label={`Stop ${model.fileName}`} onClick={handleStopLocalModel}>
                          <Square size={14} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Start ${model.fileName}`}
                          disabled={isRuntimeBusy}
                          onClick={() => handleStartLocalModel(model)}
                        >
                          <Play size={14} />
                        </button>
                      )}
                      <button type="button" aria-label={`Remove ${model.fileName}`} onClick={() => handleRemoveLocalModel(model.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })
              ) : (
                <div className="settings-row">
                  <strong>No local models imported</strong>
                  <span>Import a .gguf file from disk to make it selectable in chat.</span>
                </div>
              )}
            </div>
          ) : null}
          {isTauri ? (
            <div className="settings-section settings-mcp-servers">
              <div className="settings-section-header">
                <h3>Connected MCP Servers</h3>
                <button type="button" onClick={() => handleSelectMcpServer("new")}>
                  <Plus size={15} />
                  Add MCP Server
                </button>
              </div>
              <div className="settings-card-list">
                {mcpServers.length ? (
                  mcpServers.map((server) => {
                    const connection = mcpConnections[server.id];
                    const isConnected = connection?.state === "connected";
                    return (
                      <div className="settings-card" key={server.id}>
                        <strong>{server.name}</strong>
                        <span>
                          {server.transport === "stdio" ? server.command : server.url}
                          {isConnected ? ` / ${connection.tools.length} tool${connection.tools.length === 1 ? "" : "s"}` : " / not connected"}
                        </span>
                        <div className="settings-card-actions">
                          {isConnected ? (
                            <button type="button" aria-label={`Disconnect ${server.name}`} onClick={() => handleDisconnectMcpServer(server)}>
                              <Square size={14} />
                            </button>
                          ) : (
                            <button type="button" aria-label={`Connect ${server.name}`} onClick={() => handleConnectMcpServer(server)}>
                              <Plug size={14} />
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label={`Edit ${server.name}`}
                            onClick={() => handleSelectMcpServer(server.id)}
                          >
                            <Pencil size={14} />
                          </button>
                          <button type="button" aria-label={`Remove ${server.name}`} onClick={() => handleRemoveMcpServer(server.id)}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="settings-card">
                    <strong>No MCP servers saved</strong>
                    <span>Add a stdio or Streamable HTTP server to give the model real tools.</span>
                  </div>
                )}
              </div>
            </div>
          ) : null}
          {isTauri ? (
            isMcpModalOpen ? (
              <div className="settings-modal-scrim" role="dialog" aria-modal="true" aria-label="MCP server setup">
                <form className="settings-form settings-modal" onSubmit={handleSaveMcpServer}>
                  <header>
                    <div>
                      <h3>MCP Server</h3>
                      <p>Add or edit command, environment, headers, and connection settings.</p>
                    </div>
                    <button type="button" aria-label="Close MCP server setup" onClick={() => setIsMcpModalOpen(false)}>
                      <X size={16} />
                    </button>
                  </header>
              <label>
                <span>Editing</span>
                <select
                  value={mcpServers.some((server) => server.id === draftMcpServer.id) ? draftMcpServer.id : "new"}
                  onChange={(event) => handleSelectMcpServer(event.target.value)}
                >
                  <option value="new">New server</option>
                  {mcpServers.map((server) => (
                    <option key={server.id} value={server.id}>
                      {server.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Name</span>
                <input
                  value={draftMcpServer.name}
                  onChange={(event) => setDraftMcpServer((current) => ({ ...current, name: event.target.value }))}
                />
              </label>
              <label>
                <span>Transport</span>
                <select
                  value={draftMcpServer.transport}
                  onChange={(event) =>
                    setDraftMcpServer((current) => ({ ...current, transport: event.target.value as McpTransport }))
                  }
                >
                  <option value="stdio">Stdio</option>
                  <option value="http">Streamable HTTP</option>
                </select>
              </label>
              {draftMcpServer.transport === "stdio" ? (
                <>
                  <label>
                    <span>Command</span>
                    <input
                      value={draftMcpServer.command ?? ""}
                      onChange={(event) => setDraftMcpServer((current) => ({ ...current, command: event.target.value }))}
                      placeholder="npx"
                    />
                  </label>
                  <label>
                    <span>Arguments</span>
                    <input
                      value={mcpArgsText}
                      onChange={(event) => setMcpArgsText(event.target.value)}
                      placeholder="-y @modelcontextprotocol/server-everything"
                    />
                  </label>
                  <label>
                    <span>Working directory (optional)</span>
                    <input
                      value={draftMcpServer.cwd ?? ""}
                      onChange={(event) => setDraftMcpServer((current) => ({ ...current, cwd: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Environment variables (optional, one KEY=VALUE per line)</span>
                    <textarea
                      value={mcpEnvText}
                      onChange={(event) => setMcpEnvText(event.target.value)}
                      rows={3}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    <span>URL</span>
                    <input
                      value={draftMcpServer.url ?? ""}
                      onChange={(event) => setDraftMcpServer((current) => ({ ...current, url: event.target.value }))}
                      placeholder="http://localhost:3001/mcp"
                    />
                  </label>
                  <label>
                    <span>Headers (optional, one Key: Value per line)</span>
                    <textarea
                      value={mcpHeadersText}
                      onChange={(event) => setMcpHeadersText(event.target.value)}
                      rows={3}
                    />
                  </label>
                </>
              )}
              <div className="settings-actions">
                <button type="button" onClick={handleTestMcpConnection}>
                  <Plug size={15} />
                  Test connection
                </button>
                <button type="submit">
                  <Save size={15} />
                  Save server
                </button>
                <button type="button" onClick={() => handleSelectMcpServer("new")}>
                  <Plus size={15} />
                  New server
                </button>
              </div>
              <p className="settings-note">
                <KeyRound size={14} />
                {mcpStatus}
              </p>
              {mcpTestResult ? (
                <div className="settings-row">
                  <strong>{mcpTestResult.tools.length} tool{mcpTestResult.tools.length === 1 ? "" : "s"} discovered</strong>
                  <span>{mcpTestResult.tools.map((tool) => tool.name).join(", ") || "No tools reported."}</span>
                </div>
              ) : null}
                </form>
              </div>
            ) : null
          ) : null}
          <div className="settings-form">
            <h3>Built-in Tools</h3>
            <p className="settings-note">
              These run inside Navi without an MCP server. Toggle which ones the model can call.
            </p>
            <div className="settings-model-list">
              {builtinTools.map((tool) => (
                <label className="settings-model-checkbox" key={tool.name}>
                  <input
                    type="checkbox"
                    checked={enabledToolNames.includes(tool.name)}
                    onChange={() => handleToggleBuiltinTool(tool.name)}
                  />
                  <span>
                    <strong>{tool.name}</strong> — {tool.description}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
