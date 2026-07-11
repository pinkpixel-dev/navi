import { FormEvent, useEffect, useState } from "react";
import { KeyRound, Plus, RefreshCw, Save, X } from "lucide-react";
import { createOpenAICompatibleProvider } from "../core/providers/openAICompatibleProvider";
import {
  createDefaultProviderConfigRepository,
  type ProviderConfig,
} from "../core/providers/providerConfig";
import type { AppSettings, SubmitShortcut } from "../core/settings/appSettings";

interface SettingsPanelProps {
  providerConfigs: ProviderConfig[];
  onProviderConfigsChange: (providerConfigs: ProviderConfig[]) => void;
  appSettings: AppSettings;
  onAppSettingsChange: (appSettings: AppSettings) => void;
  onClose: () => void;
}

const providerConfigRepository = createDefaultProviderConfigRepository();

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
  appSettings,
  onAppSettingsChange,
  onClose,
}: SettingsPanelProps) {
  const [draftProvider, setDraftProvider] = useState<ProviderConfig>(providerConfigs[0] ?? createDraftProvider());
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState("Provider config is local to this app.");

  useEffect(() => {
    setDraftProvider((current) => providerConfigs.find((config) => config.id === current.id) ?? providerConfigs[0] ?? createDraftProvider());
  }, [providerConfigs]);

  const updateDraft = (patch: Partial<ProviderConfig>) => {
    setDraftProvider((current) => ({ ...current, ...patch }));
  };

  const handleFetchModels = async () => {
    if (draftProvider.type !== "openai-compatible" || !draftProvider.baseUrl) {
      setStatus("Model fetching is only available for compatible endpoints right now.");
      return;
    }

    const provider = createOpenAICompatibleProvider({
      baseUrl: draftProvider.baseUrl,
      apiKey: apiKey || undefined,
      model: draftProvider.defaultModelId || "model",
    });

    try {
      const models = await provider.listModels?.();
      if (!models?.length) {
        setStatus("No models were returned by this endpoint.");
        return;
      }

      updateDraft({
        models,
        defaultModelId: draftProvider.defaultModelId || models[0].id,
      });
      setStatus(`Fetched ${models.length} model${models.length === 1 ? "" : "s"}.`);
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
              <select value={draftProvider.type} onChange={() => updateDraft({ type: "openai-compatible" })}>
                <option value="openai-compatible">OpenAI-compatible</option>
              </select>
            </label>
            {draftProvider.type === "openai-compatible" ? (
              <>
                <label>
                  <span>Base URL</span>
                  <input
                    value={draftProvider.baseUrl ?? ""}
                    onChange={(event) => updateDraft({ baseUrl: event.target.value })}
                  />
                </label>
                <label>
                  <span>API key (optional)</span>
                  <input
                    type="password"
                    value={apiKey}
                    placeholder={draftProvider.hasApiKey ? "Saved key available" : "No key required for some endpoints"}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                </label>
              </>
            ) : null}
            <label>
              <span>Default model</span>
              <input
                value={draftProvider.defaultModelId}
                onChange={(event) => updateDraft({ defaultModelId: event.target.value })}
                placeholder="model id"
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
          <div>
            <h3>{draftProvider.name ? `${draftProvider.name} models` : "Models"}</h3>
            {draftProvider.models.length ? (
              draftProvider.models.map((model) => (
                <div className="settings-row" key={model.id}>
                  <strong>{model.name}</strong>
                  <span>{model.location} / {model.contextTokens.toLocaleString()} tokens</span>
                </div>
              ))
            ) : (
              <div className="settings-row">
                <strong>No models fetched</strong>
                <span>Fetch models or enter a default model to use this provider.</span>
              </div>
            )}
          </div>
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
                  <span>{provider.hasApiKey ? "saved key" : "key optional"} / {provider.baseUrl ?? "No endpoint URL"}</span>
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
