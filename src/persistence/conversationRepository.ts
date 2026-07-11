import { invoke } from "@tauri-apps/api/core";
import type { Artifact } from "../canvas/artifacts";
import type { RunEvent } from "../core/agent-loop/types";
import type { Conversation } from "../core/conversation/types";

export interface ConversationSnapshot {
  conversation: Conversation;
  runEvents: RunEvent[];
  artifacts: Artifact[];
}

export interface PersistenceDriver {
  loadConversationSnapshots: () => Promise<ConversationSnapshot[]>;
  saveConversationSnapshot: (snapshot: ConversationSnapshot) => Promise<void>;
}

export interface ConversationRepository {
  loadConversations: () => Promise<ConversationSnapshot[]>;
  saveConversation: (snapshot: ConversationSnapshot) => Promise<void>;
}

export function createConversationRepository(driver: PersistenceDriver): ConversationRepository {
  return {
    loadConversations: () => driver.loadConversationSnapshots(),
    saveConversation: (snapshot) => driver.saveConversationSnapshot(snapshot),
  };
}

export function createMemoryPersistenceDriver(): PersistenceDriver {
  let snapshots: ConversationSnapshot[] = [];

  return {
    async loadConversationSnapshots() {
      return [...snapshots];
    },
    async saveConversationSnapshot(snapshot) {
      snapshots = [
        snapshot,
        ...snapshots.filter((currentSnapshot) => currentSnapshot.conversation.id !== snapshot.conversation.id),
      ];
    },
  };
}

export function createTauriPersistenceDriver(): PersistenceDriver {
  return {
    loadConversationSnapshots: () => invoke<ConversationSnapshot[]>("load_conversation_snapshots"),
    saveConversationSnapshot: (snapshot) => invoke<void>("save_conversation_snapshot", { snapshot }),
  };
}

export function createDefaultConversationRepository(): ConversationRepository {
  const isTauri = "__TAURI_INTERNALS__" in window;
  return createConversationRepository(isTauri ? createTauriPersistenceDriver() : createMemoryPersistenceDriver());
}
