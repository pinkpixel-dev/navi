import { FormEvent, useEffect, useState } from "react";
import { FolderOpen, KeyRound, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { createOpenAICompatibleProvider } from "../core/providers/openAICompatibleProvider";
import { createOpenAIProvider } from "../core/providers/openAIProvider";
import {
  createDefaultProviderConfigRepository,
  type ProviderConfig,
  type ProviderType,
} from "../core/providers/providerConfig";
import { createDefaultLocalModelRepository, type LocalModel } from "../core/local-models/localModel";
import type { AppSettings, SubmitShortcut } from "../core/settings/appSettings";

interface SettingsPanelProps {
  providerConfigs: ProviderConfig[];
  onProviderConfigsChange: (providerConfigs: ProviderConfig[]) => void;
  localModels: LocalModel[];
  onLocalModelsChange: (localModels: LocalModel[]) => void;
  appSettings: AppSettings;
  onAppSettingsChange: (appSettings: AppSettings) => void;
  onClose: () => void;
}

const providerConfigRepository = createDefaultProviderConfigRepository();
const localModelRepository = createDefaultLocalModelRepository();
const isTauri = "__TAURI_INTERNALS__" in window;

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

export function SettingsPanel({
  providerConfigs,
  onProviderConfigsChange,
  localModels,
  onLocalModelsChange,
  appSettings,
  onAppSettingsChange,
  onClose,
}: SettingsPanelProps) {
  const [draftProvider, setDraftProvider] = useState<ProviderConfig>(providerConfigs[0] ?? createDraftProvider());
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState("Provider config is local to this app.");
  const [localModelStatus, setLocalModelStatus] = useState("Import a .gguf file to make it selectable in chat.");

  useEffect(() => {
    setDraftProvider((current) => providerConfigs.find((config) => config.id === current.id) ?? providerConfigs[0] ?? createDraftProvider());
  }, [providerConfigs]);

  const updateDraft = (patch: Partial<ProviderConfig>) => {
    setDraftProvider((current) => ({ ...current, ...patch }));
  };

  const handleFetchModels = async () => {
    let provider: ReturnType<typeof createOpenAICompatibleProvider>;

    if (draftProvider.type === "openai-compatible") {
      if (!draftProvider.baseUrl) {
        setStatus("Add a base URL before fetching models.");
        return;
      }

      provider = createOpenAICompatibleProvider({
        baseUrl: draftProvider.baseUrl,
        apiKey: apiKey || undefined,
        model: draftProvider.defaultModelId || "model",
      });
    } else {
      if (!apiKey && !draftProvider.hasApiKey) {
        setStatus("Add an API key before fetching models.");
        return;
      }

      provider = createOpenAIProvider({
        apiKey: apiKey || (await providerConfigRepository.getProviderApiKey(draftProvider.id)) || "",
        model: draftProvider.defaultModelId || "gpt-4o-mini",
      });
    }

    try {
      const models = await provider.listModels?.();
      if (!models?.length) {
        setStatus("No models were returned by this endpoint.");
        return;
      }

      updateDraft({ models });
      setStatus(`Fetched ${models.length} model${models.length === 1 ? "" : "s"}. All of them are selectable from the chat model picker.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not fetch models.");
    }
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
  };

  const handleSelectProvider = (providerId: string) => {
    if (providerId === "new") {
      setDraftProvider(createDraftProvider());
      setApiKey("");
      setStatus("New provider draft.");
      return;
    }

    const nextProvider = providerConfigs.find((config) => config.id === providerId);
    if (nextProvider) {
      setDraftProvider(nextProvider);
      setApiKey("");
      setStatus(nextProvider.hasApiKey ? "Saved key available." : "No key saved for this provider.");
    }
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
          <div className="settings-form">
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
          <form className="settings-form" onSubmit={handleSubmit}>
            <h3>Provider Setup</h3>
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
              <span>Name</span>
              <input
                value={draftProvider.name}
                onChange={(event) => updateDraft({ name: event.target.value })}
              />
            </label>
            <label>
              <span>Type</span>
              <select
                value={draftProvider.type}
                onChange={(event) => {
                  const nextType = event.target.value as ProviderType;
                  updateDraft({ type: nextType, baseUrl: nextType === "openai" ? undefined : draftProvider.baseUrl });
                }}
              >
                <option value="openai-compatible">OpenAI-compatible</option>
                <option value="openai">OpenAI</option>
              </select>
            </label>
            {draftProvider.type === "openai-compatible" ? (
              <label>
                <span>Base URL</span>
                <input
                  value={draftProvider.baseUrl ?? ""}
                  onChange={(event) => updateDraft({ baseUrl: event.target.value })}
                />
              </label>
            ) : null}
            <label>
              <span>API key{draftProvider.type === "openai" ? "" : " (optional)"}</span>
              <input
                type="password"
                value={apiKey}
                placeholder={
                  draftProvider.hasApiKey
                    ? "Saved key available"
                    : draftProvider.type === "openai"
                    ? "Required for api.openai.com"
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
          </form>
          {isTauri ? (
            <div>
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
              <p className="settings-note">
                <KeyRound size={14} />
                {localModelStatus}
              </p>
              {localModels.length ? (
                localModels.map((model) => (
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
                    </span>
                    <button type="button" aria-label={`Remove ${model.fileName}`} onClick={() => handleRemoveLocalModel(model.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              ) : (
                <div className="settings-row">
                  <strong>No local models imported</strong>
                  <span>Import a .gguf file from disk to make it selectable in chat.</span>
                </div>
              )}
            </div>
          ) : null}
          <div>
            <h3>Providers</h3>
            {providerConfigs.length ? (
              providerConfigs.map((provider) => (
                <button
                  className={provider.id === draftProvider.id ? "settings-row settings-row-button active" : "settings-row settings-row-button"}
                  key={provider.id}
                  type="button"
                  onClick={() => handleSelectProvider(provider.id)}
                >
                  <strong>{provider.name}</strong>
                  <span>
                    {provider.hasApiKey ? "saved key" : "key optional"} /{" "}
                    {provider.type === "openai" ? "api.openai.com" : provider.baseUrl ?? "No endpoint URL"}
                  </span>
                </button>
              ))
            ) : (
              <div className="settings-row">
                <strong>No providers saved</strong>
                <span>Add an OpenAI-compatible endpoint to start chatting.</span>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
