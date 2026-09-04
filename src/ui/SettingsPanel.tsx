import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpCircle, FolderOpen, KeyRound, Pencil, Play, Plug, Plus, RefreshCw, Save, Square, Trash2, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { describeError } from "../core/errorMessage";
import { createProviderFromConfig } from "../core/providers/createProvider";
import {
  createDefaultProviderConfigRepository,
  type ProviderConfig,
  type ProviderType,
} from "../core/providers/providerConfig";
import { createDefaultLocalModelRepository, type LocalModel } from "../core/local-models/localModel";
import {
  createDefaultLlamaRuntimeDriver,
  unknownRuntimeUpdateInfo,
  type LocalRuntimeAcceleration,
  type LocalRuntimeStatus,
  type LocalRuntimeUpdateInfo,
} from "../core/local-models/llamaRuntime";
import {
  createDefaultMcpServerDriver,
  type McpServerConfig,
  type McpServerStatus,
  type McpTransport,
} from "../core/mcp/mcpServer";
import {
  activePresetOptions,
  buildPresetMcpServerConfig,
  mcpToolPresets,
  missingRequiredPresetOptions,
  presetForServerId,
  presetServerId,
  valuesFromPresetServerConfig,
  type McpToolPreset,
} from "../core/tools/mcpToolPresets";
import type { AppSettings } from "../core/settings/appSettings";
import { confirmDestructiveAction } from "./confirmDialog";
import { GeneralSettings } from "./GeneralSettings";

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
  const [runtimeUpdate, setRuntimeUpdate] = useState<LocalRuntimeUpdateInfo>(unknownRuntimeUpdateInfo);
  const [isCheckingRuntimeUpdate, setIsCheckingRuntimeUpdate] = useState(false);
  const [runtimeUpdateStatus, setRuntimeUpdateStatus] = useState<string | null>(null);
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

  // Checks once when settings open. The backend caches the GitHub answer for a day,
  // so this is usually a local read and never nags when the machine is offline.
  useEffect(() => {
    if (!isTauri) {
      return;
    }
    llamaRuntimeDriver
      .checkRuntimeUpdate(appSettings.customLlamaServerPath, appSettings.localRuntimeAcceleration ?? "auto")
      .then(setRuntimeUpdate)
      .catch(() => {});
  }, [appSettings.customLlamaServerPath, appSettings.localRuntimeAcceleration]);

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
  const customMcpServers = useMemo(() => mcpServers.filter((server) => !presetForServerId(server.id)), [mcpServers]);

  const runtimeVersionSummary = useMemo(() => {
    if (runtimeUpdate.usingCustomBinary) {
      return "Using your custom llama-server path, so Navi does not manage updates for it.";
    }
    if (!runtimeUpdate.installedVersion) {
      return "Not downloaded yet. Navi installs the newest build the first time you start a local model.";
    }
    const parts = [`Installed ${runtimeUpdate.installedVersion}`];
    if (runtimeUpdate.latestVersion && !runtimeUpdate.updateAvailable) {
      parts.push("newest available");
    }
    if (runtimeUpdate.checkedAt) {
      parts.push(`checked ${new Date(runtimeUpdate.checkedAt * 1000).toLocaleDateString()}`);
    }
    return parts.join(" · ");
  }, [runtimeUpdate]);

  const updateDraft = (patch: Partial<ProviderConfig>) => {
    setDraftProvider((current) => ({ ...current, ...patch }));
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
    const currentBaseUrl = draftProvider.baseUrl?.trim();
    const currentDefaultBaseUrl = defaultBaseUrlForType(draftProvider.type);
    const nextBaseUrl = providerTypesWithBaseUrl.has(nextType)
      ? !currentBaseUrl || currentBaseUrl === currentDefaultBaseUrl
        ? defaultBaseUrlForType(nextType)
        : currentBaseUrl
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
      setLocalModelStatus(describeError(error, "Could not import this model."));
    }
  };

  const handleRemoveLocalModel = async (id: string) => {
    await localModelRepository.removeLocalModel(id);
    onLocalModelsChange(localModels.filter((model) => model.id !== id));
    setLocalModelStatus("Model removed.");
  };

  const handleCheckRuntimeUpdate = async () => {
    setIsCheckingRuntimeUpdate(true);
    setRuntimeUpdateStatus("Checking llama.cpp releases...");
    try {
      const info = await llamaRuntimeDriver.checkRuntimeUpdate(
        appSettings.customLlamaServerPath,
        appSettings.localRuntimeAcceleration ?? "auto",
        true,
      );
      setRuntimeUpdate(info);
      if (info.message) {
        setRuntimeUpdateStatus(info.message);
      } else if (info.updateAvailable) {
        setRuntimeUpdateStatus(null);
      } else {
        setRuntimeUpdateStatus("The runtime is up to date.");
      }
    } catch (error) {
      setRuntimeUpdateStatus(describeError(error, "Could not check for a runtime update."));
    } finally {
      setIsCheckingRuntimeUpdate(false);
    }
  };

  const handleUpdateRuntime = async () => {
    setIsCheckingRuntimeUpdate(true);
    setRuntimeUpdateStatus(`Downloading llama.cpp ${runtimeUpdate.latestVersion ?? "runtime"}...`);
    try {
      if (runtimeStatus.state === "ready") {
        await llamaRuntimeDriver.stopRuntime();
        setRuntimeStatus(idleRuntimeStatus);
      }
      const info = await llamaRuntimeDriver.updateRuntime(appSettings.localRuntimeAcceleration ?? "auto");
      setRuntimeUpdate(info);
      setRuntimeUpdateStatus(`Updated to llama.cpp ${info.installedVersion ?? "the newest build"}.`);
    } catch (error) {
      setRuntimeUpdateStatus(describeError(error, "Could not update the runtime."));
    } finally {
      setIsCheckingRuntimeUpdate(false);
    }
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
        llamaRuntimeDriver
          .checkRuntimeUpdate(appSettings.customLlamaServerPath, acceleration)
          .then(setRuntimeUpdate)
          .catch(() => {});
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

  const getPresetServer = (preset: McpToolPreset) => mcpServers.find((server) => server.id === presetServerId(preset.id));

  const savePresetServer = async (config: McpServerConfig) => {
    await mcpServerDriver.saveServer(config);
    onMcpServersChange([config, ...mcpServers.filter((server) => server.id !== config.id)]);
  };

  const handlePresetOptionChange = async (preset: McpToolPreset, optionKey: string, value: string) => {
    const existingServer = getPresetServer(preset);
    const values = { ...valuesFromPresetServerConfig(preset, existingServer), [optionKey]: value };
    const config = buildPresetMcpServerConfig(preset.id, values, existingServer?.enabled ?? false);
    await savePresetServer(config);

    if (config.enabled && mcpConnections[config.id]?.state === "connected") {
      await mcpServerDriver.disconnectServer(config.id).catch(() => {});
      const nextConnections = { ...mcpConnections };
      delete nextConnections[config.id];
      onMcpConnectionsChange(nextConnections);
      setMcpStatus(`${preset.name} settings saved. Toggle it back on to reconnect.`);
      return;
    }

    setMcpStatus(`${preset.name} settings saved.`);
  };

  const handleChoosePresetPath = async (preset: McpToolPreset, optionKey: string, type: "directory" | "file") => {
    const selected = await open({
      directory: type === "directory",
      multiple: false,
    });
    if (typeof selected === "string") {
      await handlePresetOptionChange(preset, optionKey, selected);
    }
  };

  const handleTogglePreset = async (preset: McpToolPreset) => {
    const existingServer = getPresetServer(preset);
    const values = valuesFromPresetServerConfig(preset, existingServer);
    const shouldEnable = !existingServer?.enabled;
    const missingOptions = shouldEnable ? missingRequiredPresetOptions(preset.id, values) : [];

    if (missingOptions.length) {
      setMcpStatus(`Add the required ${preset.name} option${missingOptions.length === 1 ? "" : "s"} before turning it on.`);
      return;
    }

    const config = buildPresetMcpServerConfig(preset.id, values, shouldEnable);
    await savePresetServer(config);

    if (!shouldEnable) {
      await mcpServerDriver.disconnectServer(config.id).catch(() => {});
      const nextConnections = { ...mcpConnections };
      delete nextConnections[config.id];
      onMcpConnectionsChange(nextConnections);
      setMcpStatus(`${preset.name} turned off.`);
      return;
    }

    setMcpStatus(`Connecting to ${preset.name}...`);
    try {
      const result = await mcpServerDriver.connectServer(config);
      onMcpConnectionsChange({ ...mcpConnections, [config.id]: result });
      setMcpStatus(`${preset.name}: ${result.tools.length} tool${result.tools.length === 1 ? "" : "s"} available.`);
    } catch (error) {
      const disabledConfig = { ...config, enabled: false };
      await savePresetServer(disabledConfig);
      setMcpStatus(error instanceof Error ? error.message : `Could not connect to ${preset.name}.`);
    }
  };

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
          <GeneralSettings appSettings={appSettings} onChange={onAppSettingsChange} />
          <div className="settings-form settings-personalization">
            <h3>Personalization</h3>
            <label>
              <span>Name</span>
              <input
                value={appSettings.userName ?? ""}
                onChange={(event) => onAppSettingsChange({ ...appSettings, userName: event.target.value })}
                placeholder="Used in the new chat screen and model context"
              />
            </label>
            <label>
              <span>Short bio</span>
              <textarea
                value={appSettings.userBio ?? ""}
                onChange={(event) => onAppSettingsChange({ ...appSettings, userBio: event.target.value })}
                placeholder="A tiny bit of context about you"
                rows={3}
              />
            </label>
            <label>
              <span>Custom instructions</span>
              <textarea
                value={appSettings.userInstructions ?? ""}
                onChange={(event) => onAppSettingsChange({ ...appSettings, userInstructions: event.target.value })}
                placeholder="How Navi should respond across chats"
                rows={4}
              />
            </label>
          </div>
          <div className="settings-form settings-avatars">
            <h3>Avatars</h3>
            <p className="settings-note">Shown next to messages. PNG, JPEG, GIF, or WebP.</p>
            <div className="settings-avatar-row">
              <img
                className={appSettings.userAvatar ? "settings-avatar" : "settings-avatar default-avatar-accent"}
                src={appSettings.userAvatar ?? "/user.png"}
                alt="User avatar"
              />
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
                className={appSettings.assistantAvatar ? "settings-avatar" : "settings-avatar default-avatar-accent"}
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
              <div
                className={`settings-row settings-runtime-row${runtimeUpdate.updateAvailable ? " is-update-available" : ""}`}
              >
                <strong>
                  {runtimeUpdate.updateAvailable ? (
                    <>
                      <ArrowUpCircle size={14} aria-hidden="true" />
                      llama.cpp {runtimeUpdate.latestVersion} is available
                    </>
                  ) : (
                    "llama.cpp runtime"
                  )}
                </strong>
                <span>{runtimeVersionSummary}</span>
                {runtimeUpdateStatus ? <span role="status">{runtimeUpdateStatus}</span> : null}
                {runtimeUpdate.usingCustomBinary ? null : (
                  <div className="settings-actions">
                    {runtimeUpdate.updateAvailable ? (
                      <button
                        type="button"
                        onClick={handleUpdateRuntime}
                        disabled={isCheckingRuntimeUpdate || isRuntimeBusy}
                        title={`Download llama.cpp ${runtimeUpdate.latestVersion} and keep the current build for rollback`}
                      >
                        <ArrowUpCircle size={15} />
                        Update runtime
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={handleCheckRuntimeUpdate}
                      disabled={isCheckingRuntimeUpdate}
                      title="Ask GitHub for the newest llama.cpp release now"
                    >
                      <RefreshCw size={15} />
                      Check for updates
                    </button>
                  </div>
                )}
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
                {customMcpServers.length ? (
                  customMcpServers.map((server) => {
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
                  value={customMcpServers.some((server) => server.id === draftMcpServer.id) ? draftMcpServer.id : "new"}
                  onChange={(event) => handleSelectMcpServer(event.target.value)}
                >
                  <option value="new">New server</option>
                  {customMcpServers.map((server) => (
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
          {isTauri ? (
            <div className="settings-section settings-mcp-presets">
              <div className="settings-section-header">
                <h3>Navi Tools</h3>
                <p>Curated MCP servers with simple toggles.</p>
              </div>
              <div className="settings-card-list settings-preset-list">
                {mcpToolPresets.map((preset) => {
                  const server = getPresetServer(preset);
                  const values = valuesFromPresetServerConfig(preset, server);
                  const visibleOptions = activePresetOptions(preset, values);
                  const isEnabled = Boolean(server?.enabled);
                  const isConnected = mcpConnections[presetServerId(preset.id)]?.state === "connected";
                  return (
                    <div className="settings-card settings-preset-card" key={preset.id}>
                      <div className="settings-preset-card-header">
                        <div>
                          <strong>{preset.name}</strong>
                          <span>{isConnected ? "Connected" : isEnabled ? "Enabled" : "Off"}</span>
                        </div>
                        <button
                          type="button"
                          className={isEnabled ? "settings-toggle active" : "settings-toggle"}
                          aria-pressed={isEnabled}
                          onClick={() => handleTogglePreset(preset)}
                        >
                          {isEnabled ? "On" : "Off"}
                        </button>
                      </div>
                      <span>{preset.description}</span>
                      {visibleOptions.length ? (
                        <div className="settings-preset-options">
                          {visibleOptions.map((option) => (
                            <label key={option.key}>
                              <span>{option.label}</span>
                              {option.type === "select" ? (
                                <select
                                  value={values[option.key] ?? ""}
                                  onChange={(event) => handlePresetOptionChange(preset, option.key, event.target.value)}
                                >
                                  <option value="">Select...</option>
                                  {(option.options ?? []).map((item) => (
                                    <option key={item.value} value={item.value}>
                                      {item.label}
                                    </option>
                                  ))}
                                </select>
                              ) : option.type === "directory" || option.type === "file" ? (
                                <div className="settings-inline-input">
                                  <input
                                    value={values[option.key] ?? ""}
                                    onChange={(event) => handlePresetOptionChange(preset, option.key, event.target.value)}
                                    placeholder={option.placeholder}
                                  />
                                  <button
                                    type="button"
                                    aria-label={`Choose ${option.label}`}
                                    onClick={() =>
                                      handleChoosePresetPath(
                                        preset,
                                        option.key,
                                        option.type === "directory" ? "directory" : "file",
                                      )
                                    }
                                  >
                                    <FolderOpen size={14} />
                                  </button>
                                </div>
                              ) : (
                                <input
                                  type={option.type === "password" ? "password" : "text"}
                                  value={values[option.key] ?? ""}
                                  onChange={(event) => handlePresetOptionChange(preset, option.key, event.target.value)}
                                  placeholder={option.placeholder}
                                />
                              )}
                            </label>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <p className="settings-note">
                <KeyRound size={14} />
                API keys and paths are saved in the local MCP server configuration, matching regular MCP config behavior.
              </p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
