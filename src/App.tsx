import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { CanvasPanel } from "./ui/CanvasPanel";
import { ChatWorkspace } from "./ui/ChatWorkspace";
import { Sidebar } from "./ui/Sidebar";
import { SettingsPanel } from "./ui/SettingsPanel";
import { confirmDestructiveAction } from "./ui/confirmDialog";
import { seedConversations } from "./core/conversation/seed";
import type { Conversation, ChatMessage, ToolCallEvent } from "./core/conversation/types";
import { runAgentLoop } from "./core/agent-loop/agentLoop";
import type { ApprovalDecision, RunEvent } from "./core/agent-loop/types";
import { chatRunReducer, createInitialChatRunState } from "./core/chat-state/chatRunReducer";
import { createArtifactFromMessage } from "./canvas/artifacts";
import { createDefaultConversationRepository } from "./persistence/conversationRepository";
import { createDefaultProviderConfigRepository, type ProviderConfig } from "./core/providers/providerConfig";
import { createOpenAICompatibleProvider } from "./core/providers/openAICompatibleProvider";
import { createOpenAIProvider } from "./core/providers/openAIProvider";
import { createOllamaProvider } from "./core/providers/ollamaProvider";
import { providerModels } from "./core/providers/registry";
import type {
  ChatProvider,
  ProviderCompleteInput,
  ProviderModel,
  ProviderResponse,
  ProviderToolSchema,
} from "./core/providers/types";
import { createDefaultLocalModelRepository, type LocalModel } from "./core/local-models/localModel";
import { createDefaultLlamaRuntimeDriver } from "./core/local-models/llamaRuntime";
import { loadAppSettings, saveAppSettings, type AppSettings } from "./core/settings/appSettings";
import { createDefaultMcpServerDriver, type McpServerConfig, type McpServerStatus } from "./core/mcp/mcpServer";
import { mcpToolRisk, toProviderToolSchema } from "./core/mcp/mcpToolSchema";

const conversationRepository = createDefaultConversationRepository();
const providerConfigRepository = createDefaultProviderConfigRepository();
const localModelRepository = createDefaultLocalModelRepository();
const llamaRuntimeDriver = createDefaultLlamaRuntimeDriver();
const mcpServerDriver = createDefaultMcpServerDriver();

interface PendingApproval {
  toolCall: ToolCallEvent;
  resolve: (decision: ApprovalDecision) => void;
}

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

function createPickerModelsForProviderConfig(config: ProviderConfig): ProviderModel[] {
  const models = createModelsForProviderConfig(config);
  if (!config.enabledModelIds) {
    return models;
  }
  const enabledIds = new Set(config.enabledModelIds);
  return models.filter((model) => enabledIds.has(model.id));
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
    updatedAt: new Date().toISOString(),
    messages: [],
  };
}

/**
 * Provider adapters classify tool-call risk from the tool name alone (they only see the
 * OpenAI-style wire format, not the original MCP tool's annotations). Override with the
 * annotation-aware classification once we know which MCP tool each call actually maps to.
 */
async function completeWithToolRiskOverrides(
  provider: ChatProvider,
  input: ProviderCompleteInput,
  toolRiskByName: Map<string, ToolCallEvent["risk"]>,
): Promise<ProviderResponse> {
  const response = await provider.complete(input);
  if (!toolRiskByName.size || !response.toolCalls.length) {
    return response;
  }

  const overrideRisk = (toolCall: ToolCallEvent): ToolCallEvent => ({
    ...toolCall,
    risk: toolRiskByName.get(toolCall.toolName) ?? toolCall.risk,
  });

  return {
    message: {
      ...response.message,
      toolCalls: response.message.toolCalls?.map(overrideRisk),
    },
    toolCalls: response.toolCalls.map(overrideRisk),
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
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [mcpConnections, setMcpConnections] = useState<Record<string, McpServerStatus>>({});
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const lastOpenedArtifactId = useRef<string | null>(null);
  const conversationApprovals = useRef<Map<string, Set<string>>>(new Map());

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
      ...providerConfigs.flatMap(createPickerModelsForProviderConfig),
      ...localModels.map(createModelFromLocalModel),
    ],
    [providerConfigs, localModels],
  );

  const toolRoute = useMemo(() => {
    const route = new Map<string, { serverId: string; serverName: string }>();
    for (const [serverId, status] of Object.entries(mcpConnections)) {
      const serverName = mcpServers.find((server) => server.id === serverId)?.name ?? serverId;
      for (const tool of status.tools) {
        route.set(tool.name, { serverId, serverName });
      }
    }
    return route;
  }, [mcpConnections, mcpServers]);

  const availableTools = useMemo<ProviderToolSchema[]>(() => {
    const tools: ProviderToolSchema[] = [];
    for (const status of Object.values(mcpConnections)) {
      for (const tool of status.tools) {
        tools.push(toProviderToolSchema(tool));
      }
    }
    return tools;
  }, [mcpConnections]);

  const toolRiskByName = useMemo(() => {
    const risks = new Map<string, ToolCallEvent["risk"]>();
    for (const status of Object.values(mcpConnections)) {
      for (const tool of status.tools) {
        risks.set(tool.name, mcpToolRisk(tool));
      }
    }
    return risks;
  }, [mcpConnections]);

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
    mcpServerDriver
      .loadServers()
      .then(async (servers) => {
        setMcpServers(servers);
        const statuses = await Promise.all(
          servers.map(async (server) => [server.id, await mcpServerDriver.getServerStatus(server.id)] as const),
        );
        setMcpConnections(Object.fromEntries(statuses.filter(([, status]) => status.state === "connected")));
      })
      .catch((error: unknown) => {
        console.error("Could not load MCP servers", error);
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

    const selectedOllamaConfig = providerConfigs
      .filter((config) => config.type === "ollama")
      .find(matchesActiveModel);

    if (selectedOllamaConfig) {
      const apiKey = await providerConfigRepository.getProviderApiKey(selectedOllamaConfig.id);
      return createOllamaProvider({
        baseUrl: selectedOllamaConfig.baseUrl,
        apiKey: apiKey ?? undefined,
        model: activeConversation.model || selectedOllamaConfig.defaultModelId,
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

  const executeTool = async (toolCall: ToolCallEvent): Promise<{ content: string; isError: boolean }> => {
    const route = toolRoute.get(toolCall.toolName);
    if (!route) {
      return { content: `Tool '${toolCall.toolName}' is not currently available.`, isError: true };
    }

    try {
      return await mcpServerDriver.callTool(route.serverId, toolCall.toolName, toolCall.arguments ?? "{}");
    } catch (error) {
      return {
        content: error instanceof Error ? error.message : `Could not call tool '${toolCall.toolName}'.`,
        isError: true,
      };
    }
  };

  const requestApproval = (toolCall: ToolCallEvent): Promise<ApprovalDecision> => {
    const allowedTools = conversationApprovals.current.get(activeConversation.id);
    if (allowedTools?.has(toolCall.toolName)) {
      return Promise.resolve("allow-once");
    }

    return new Promise<ApprovalDecision>((resolve) => {
      setPendingApproval({
        toolCall,
        resolve: (decision) => {
          if (decision === "allow-conversation") {
            const existing = conversationApprovals.current.get(activeConversation.id) ?? new Set<string>();
            existing.add(toolCall.toolName);
            conversationApprovals.current.set(activeConversation.id, existing);
          }
          setPendingApproval(null);
          resolve(decision);
        },
      });
    });
  };

  const handleNewChat = () => {
    const preferredModel = availableModels.length
      ? pickPreferredModel(availableModels, appSettings.lastModelId)
      : undefined;
    const conversation = createBlankConversation(preferredModel);

    setConversations((current) => [conversation, ...current]);
    setActiveConversationId(conversation.id);
    dispatchRunState({ type: "reset" });
    saveConversationSnapshot(conversation, [], []).catch((error: unknown) => {
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
              title: conversation.title === "New chat" ? content.slice(0, 48) : conversation.title,
              updatedAt: new Date().toISOString(),
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
        title: activeConversation.title === "New chat" ? content.slice(0, 48) : activeConversation.title,
        updatedAt: new Date().toISOString(),
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
      tools: availableTools.length ? availableTools : undefined,
      executeTool,
      requestApproval,
      providerComplete: (providerInput) => completeWithToolRiskOverrides(activeProvider, providerInput, toolRiskByName),
      onEvent: (event: RunEvent) => dispatchRunState({ type: "event", event }),
    });

    const completedConversation: Conversation = {
      ...activeConversation,
      title: activeConversation.title === "New chat" ? content.slice(0, 48) : activeConversation.title,
      updatedAt: new Date().toISOString(),
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

  const handleDeleteConversation = async (id: string) => {
    const target = conversations.find((conversation) => conversation.id === id);
    if (!target) {
      return;
    }

    const confirmed = await confirmDestructiveAction(`Delete "${target.title}"? This can't be undone.`);
    if (!confirmed) {
      return;
    }

    const remaining = conversations.filter((conversation) => conversation.id !== id);

    if (remaining.length === 0) {
      const preferredModel = availableModels.length
        ? pickPreferredModel(availableModels, appSettings.lastModelId)
        : undefined;
      const replacement = createBlankConversation(preferredModel);
      setConversations([replacement]);
      setActiveConversationId(replacement.id);
      saveConversationSnapshot(replacement, [], []).catch((error: unknown) => {
        console.error("Could not save replacement conversation", error);
      });
    } else {
      setConversations(remaining);
      if (id === activeConversationId) {
        setActiveConversationId(remaining[0].id);
      }
    }

    conversationApprovals.current.delete(id);
    conversationRepository.deleteConversation(id).catch((error: unknown) => {
      console.error("Could not delete conversation", error);
    });
  };

  const handleTogglePin = (id: string) => {
    const target = conversations.find((conversation) => conversation.id === id);
    if (!target) {
      return;
    }

    const updated: Conversation = { ...target, isPinned: !target.isPinned, updatedAt: new Date().toISOString() };
    setConversations((current) => current.map((conversation) => (conversation.id === id ? updated : conversation)));
    conversationRepository.updateConversationMetadata(updated).catch((error: unknown) => {
      console.error("Could not save pin state", error);
    });
  };

  const handleRenameConversation = (id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) {
      return;
    }

    const target = conversations.find((conversation) => conversation.id === id);
    if (!target || target.title === trimmed) {
      return;
    }

    const updated: Conversation = { ...target, title: trimmed };
    setConversations((current) => current.map((conversation) => (conversation.id === id ? updated : conversation)));
    conversationRepository.updateConversationMetadata(updated).catch((error: unknown) => {
      console.error("Could not save renamed conversation", error);
    });
  };

  const handleModelChange = (model: ProviderModel) => {
    const updatedConversation: Conversation = {
      ...activeConversation,
      provider: model.provider,
      model: model.id,
      processing: model.location === "cloud" ? "cloud" : model.location === "local" ? "local" : "external",
      updatedAt: new Date().toISOString(),
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
        onDeleteConversation={handleDeleteConversation}
        onTogglePin={handleTogglePin}
        onRenameConversation={handleRenameConversation}
      />
      <ChatWorkspace
        conversation={activeConversation}
        isRunning={isRunning}
        runState={runState}
        isCanvasOpen={isCanvasOpen}
        availableModels={availableModels}
        submitShortcut={appSettings.submitShortcut}
        pendingApprovalToolCall={pendingApproval?.toolCall ?? null}
        onApprovalDecision={(decision) => pendingApproval?.resolve(decision)}
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
          mcpServers={mcpServers}
          onMcpServersChange={setMcpServers}
          mcpConnections={mcpConnections}
          onMcpConnectionsChange={setMcpConnections}
          appSettings={appSettings}
          onAppSettingsChange={handleAppSettingsChange}
          onClose={() => setShowSettings(false)}
        />
      ) : null}
    </main>
  );
}
