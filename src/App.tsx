import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { CanvasPanel } from "./ui/CanvasPanel";
import { ChatWorkspace } from "./ui/ChatWorkspace";
import { Sidebar } from "./ui/Sidebar";
import { SettingsPanel } from "./ui/SettingsPanel";
import { seedConversations } from "./core/conversation/seed";
import type { Conversation, ChatMessage } from "./core/conversation/types";
import { runAgentLoop } from "./core/agent-loop/agentLoop";
import type { RunEvent } from "./core/agent-loop/types";
import { chatRunReducer, createInitialChatRunState } from "./core/chat-state/chatRunReducer";
import { createArtifactFromMessage } from "./canvas/artifacts";
import { createDefaultConversationRepository } from "./persistence/conversationRepository";
import { createDefaultProviderConfigRepository, type ProviderConfig } from "./core/providers/providerConfig";
import { createOpenAICompatibleProvider } from "./core/providers/openAICompatibleProvider";
import { createOpenAIProvider } from "./core/providers/openAIProvider";
import { providerModels } from "./core/providers/registry";
import type { ChatProvider, ProviderModel } from "./core/providers/types";
import { createDefaultLocalModelRepository, type LocalModel } from "./core/local-models/localModel";
import { createDefaultLlamaRuntimeDriver } from "./core/local-models/llamaRuntime";
import { loadAppSettings, saveAppSettings, type AppSettings } from "./core/settings/appSettings";

const conversationRepository = createDefaultConversationRepository();
const providerConfigRepository = createDefaultProviderConfigRepository();
const localModelRepository = createDefaultLocalModelRepository();
const llamaRuntimeDriver = createDefaultLlamaRuntimeDriver();

function createModelsForProviderConfig(config: ProviderConfig): ProviderModel[] {
  if (config.models.length) {
    return config.models.map((model) => ({
      ...model,
      provider: config.name,
    }));
  }

  if (!config.defaultModelId) {
    return [];
  }

  return [
    {
      id: config.defaultModelId,
      name: config.defaultModelId,
      provider: config.name,
      location: "external",
      capabilities: ["tools", "structured-output", "canvas"],
      contextTokens: 128000,
    },
  ];
}

function pickPreferredModel(models: ProviderModel[], lastModelId?: string): ProviderModel {
  return models.find((model) => model.id === lastModelId) ?? models[0];
}

function createModelFromLocalModel(model: LocalModel): ProviderModel {
  return {
    id: model.id,
    name: model.fileName,
    provider: "llama.cpp",
    location: "local",
    capabilities: ["structured-output"],
    contextTokens: model.contextLength ?? 4096,
  };
}

function createBlankConversation(model?: ProviderModel): Conversation {
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    projectName: "Navi",
    provider: model?.provider ?? "No provider",
    model: model?.id ?? "",
    processing: model?.location === "cloud" ? "cloud" : model?.location === "local" ? "local" : "external",
    isPinned: false,
    updatedAt: "Just now",
    messages: [],
  };
}

function createSetupMessage(localModel?: LocalModel): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content: localModel
      ? `Start "${localModel.fileName}" from Settings → Local Models before chatting.`
      : "Add or select a provider in Settings before sending a message.",
    createdAt: new Date().toISOString(),
  };
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>(() => seedConversations.length ? seedConversations : [createBlankConversation()]);
  const [activeConversationId, setActiveConversationId] = useState(() => conversations[0].id);
  const [isRunning, setIsRunning] = useState(false);
  const [runState, dispatchRunState] = useReducer(chatRunReducer, undefined, createInitialChatRunState);
  const [activeRunController, setActiveRunController] = useState<AbortController | null>(null);
  const [isCanvasOpen, setIsCanvasOpen] = useState(false);
  const [providerConfigs, setProviderConfigs] = useState<ProviderConfig[]>([]);
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>(() => loadAppSettings());
  const lastOpenedArtifactId = useRef<string | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? conversations[0],
    [activeConversationId, conversations],
  );

  const activeArtifact = useMemo(
    () => createArtifactFromMessage(activeConversation.messages.at(-1)),
    [activeConversation.messages],
  );
  const availableModels = useMemo(
    () => [
      ...providerModels,
      ...providerConfigs.flatMap(createModelsForProviderConfig),
      ...localModels.map(createModelFromLocalModel),
    ],
    [providerConfigs, localModels],
  );

  useEffect(() => {
    let isMounted = true;

    conversationRepository
      .loadConversations()
      .then((snapshots) => {
        if (!isMounted || snapshots.length === 0) {
          return;
        }

        const savedConversations = snapshots.map((snapshot) => snapshot.conversation);
        setConversations(savedConversations);
        setActiveConversationId(savedConversations[0].id);
      })
      .catch((error: unknown) => {
        console.error("Could not load saved conversations", error);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!availableModels.length) {
      return;
    }

    const activeModelExists = availableModels.some((model) => model.id === activeConversation.model);
    if (!activeConversation.model || !activeModelExists) {
      handleModelChange(pickPreferredModel(availableModels, appSettings.lastModelId));
    }
  }, [activeConversation.model, availableModels, appSettings.lastModelId]);

  useEffect(() => {
    providerConfigRepository
      .loadProviderConfigs()
      .then(setProviderConfigs)
      .catch((error: unknown) => {
        console.error("Could not load provider configs", error);
      });
  }, []);

  useEffect(() => {
    localModelRepository
      .loadLocalModels()
      .then(setLocalModels)
      .catch((error: unknown) => {
        console.error("Could not load local models", error);
      });
  }, []);

  useEffect(() => {
    if (activeArtifact && activeArtifact.id !== lastOpenedArtifactId.current) {
      setIsCanvasOpen(true);
    }
    lastOpenedArtifactId.current = activeArtifact?.id ?? null;
  }, [activeArtifact]);

  const handleAppSettingsChange = (nextSettings: AppSettings) => {
    setAppSettings(nextSettings);
    saveAppSettings(nextSettings);
  };

  const saveConversationSnapshot = async (
    conversation: Conversation,
    runEvents = runState.events,
    artifacts = activeArtifact ? [activeArtifact] : [],
  ) => {
    await conversationRepository.saveConversation({
      conversation,
      runEvents,
      artifacts,
    });
  };

  const matchesActiveModel = (config: ProviderConfig) =>
    config.defaultModelId === activeConversation.model ||
    createModelsForProviderConfig(config).some((model) => model.id === activeConversation.model);

  const createActiveProvider = async (): Promise<ChatProvider | null> => {
    const compatibleConfigs = providerConfigs.filter((config) => config.type === "openai-compatible");
    const selectedCompatibleConfig =
      compatibleConfigs.find(matchesActiveModel) ??
      (activeConversation.model === "openai-compatible-placeholder" && compatibleConfigs.length === 1
        ? compatibleConfigs[0]
        : undefined);

    if (selectedCompatibleConfig?.baseUrl) {
      const apiKey = await providerConfigRepository.getProviderApiKey(selectedCompatibleConfig.id);
      return createOpenAICompatibleProvider({
        baseUrl: selectedCompatibleConfig.baseUrl,
        apiKey: apiKey ?? undefined,
        model:
          activeConversation.model === "openai-compatible-placeholder"
            ? selectedCompatibleConfig.defaultModelId
            : activeConversation.model || selectedCompatibleConfig.defaultModelId,
      });
    }

    const selectedOpenAIConfig = providerConfigs
      .filter((config) => config.type === "openai")
      .find(matchesActiveModel);

    if (selectedOpenAIConfig) {
      const apiKey = await providerConfigRepository.getProviderApiKey(selectedOpenAIConfig.id);
      if (!apiKey) {
        return null;
      }

      return createOpenAIProvider({
        apiKey,
        model: activeConversation.model || selectedOpenAIConfig.defaultModelId,
      });
    }

    const selectedLocalModel = localModels.find((model) => model.id === activeConversation.model);
    if (selectedLocalModel) {
      const runtimeStatus = await llamaRuntimeDriver.getRuntimeStatus();
      if (runtimeStatus.state === "ready" && runtimeStatus.modelId === selectedLocalModel.id && runtimeStatus.port) {
        return createOpenAICompatibleProvider({
          baseUrl: `http://127.0.0.1:${runtimeStatus.port}/v1`,
          model: selectedLocalModel.id,
        });
      }
    }

    return null;
  };

  const handleNewChat = () => {
    const preferredModel = availableModels.length
      ? pickPreferredModel(availableModels, appSettings.lastModelId)
      : undefined;
    const conversation = createBlankConversation(preferredModel);

    setConversations((current) => [conversation, ...current]);
    setActiveConversationId(conversation.id);
    saveConversationSnapshot(conversation).catch((error: unknown) => {
      console.error("Could not save new conversation", error);
    });
  };

  const handleSend = async (content: string) => {
    if (!content.trim() || isRunning) {
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };

    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeConversation.id
          ? {
              ...conversation,
              title: conversation.title === "Untitled chat" ? content.slice(0, 48) : conversation.title,
              updatedAt: "Just now",
              messages: [...conversation.messages, userMessage],
            }
          : conversation,
      ),
    );

    setIsRunning(true);
    dispatchRunState({ type: "reset" });
    const controller = new AbortController();
    setActiveRunController(controller);
    const activeProvider = await createActiveProvider();
    if (!activeProvider) {
      const setupMessage = createSetupMessage(localModels.find((model) => model.id === activeConversation.model));
      const completedConversation: Conversation = {
        ...activeConversation,
        updatedAt: "Just now",
        messages: [...activeConversation.messages, userMessage, setupMessage],
      };

      setConversations((current) =>
        current.map((conversation) => (conversation.id === activeConversation.id ? completedConversation : conversation)),
      );
      saveConversationSnapshot(completedConversation, [], []).catch((error: unknown) => {
        console.error("Could not save provider setup message", error);
      });
      setIsRunning(false);
      setActiveRunController(null);
      return;
    }

    const runResult = await runAgentLoop({
      conversation: activeConversation,
      input: content,
      signal: controller.signal,
      retry: {
        maxAttempts: 2,
      },
      providerComplete: activeProvider.complete,
      onEvent: (event: RunEvent) => dispatchRunState({ type: "event", event }),
    });

    const completedConversation: Conversation = {
      ...activeConversation,
      title: activeConversation.title === "Untitled chat" ? content.slice(0, 48) : activeConversation.title,
      updatedAt: "Just now",
      messages: [...activeConversation.messages, userMessage, runResult.message],
    };

    setConversations((current) =>
      current.map((conversation) => (conversation.id === activeConversation.id ? completedConversation : conversation)),
    );
    const completedArtifact = createArtifactFromMessage(runResult.message);
    saveConversationSnapshot(completedConversation, runResult.events, completedArtifact ? [completedArtifact] : []).catch((error: unknown) => {
      console.error("Could not save completed conversation", error);
    });
    setIsRunning(false);
    setActiveRunController(null);
  };

  const handleCancelRun = () => {
    activeRunController?.abort();
  };

  const handleModelChange = (model: ProviderModel) => {
    const updatedConversation: Conversation = {
      ...activeConversation,
      provider: model.provider,
      model: model.id,
      processing: model.location === "cloud" ? "cloud" : model.location === "local" ? "local" : "external",
      updatedAt: "Just now",
    };

    setConversations((current) =>
      current.map((conversation) => (conversation.id === activeConversation.id ? updatedConversation : conversation)),
    );
    saveConversationSnapshot(updatedConversation).catch((error: unknown) => {
      console.error("Could not save selected model", error);
    });
    handleAppSettingsChange({ ...appSettings, lastModelId: model.id });
  };

  return (
    <main className={isCanvasOpen ? "app-shell" : "app-shell canvas-collapsed"}>
      <Sidebar
        activeConversationId={activeConversation.id}
        conversations={conversations}
        onNewChat={handleNewChat}
        onOpenSettings={() => setShowSettings(true)}
        onSelectConversation={setActiveConversationId}
      />
      <ChatWorkspace
        conversation={activeConversation}
        isRunning={isRunning}
        runState={runState}
        isCanvasOpen={isCanvasOpen}
        availableModels={availableModels}
        submitShortcut={appSettings.submitShortcut}
        onCancelRun={handleCancelRun}
        onModelChange={handleModelChange}
        onToggleCanvas={() => setIsCanvasOpen((current) => !current)}
        onSend={handleSend}
      />
      {isCanvasOpen ? <CanvasPanel artifact={activeArtifact} onClose={() => setIsCanvasOpen(false)} /> : null}
      {showSettings ? (
        <SettingsPanel
          providerConfigs={providerConfigs}
          onProviderConfigsChange={setProviderConfigs}
          localModels={localModels}
          onLocalModelsChange={setLocalModels}
          appSettings={appSettings}
          onAppSettingsChange={handleAppSettingsChange}
          onClose={() => setShowSettings(false)}
        />
      ) : null}
    </main>
  );
}
