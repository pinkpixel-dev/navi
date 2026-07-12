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
  deleteConversationSnapshot: (id: string) => Promise<void>;
  updateConversationMetadata: (conversation: Conversation) => Promise<void>;
}

export interface ConversationRepository {
  loadConversations: () => Promise<ConversationSnapshot[]>;
  saveConversation: (snapshot: ConversationSnapshot) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  /** Updates title/pin/etc. for a conversation without touching its stored run history. */
  updateConversationMetadata: (conversation: Conversation) => Promise<void>;
}

export function createConversationRepository(driver: PersistenceDriver): ConversationRepository {
  return {
    loadConversations: () => driver.loadConversationSnapshots(),
    saveConversation: (snapshot) => driver.saveConversationSnapshot(snapshot),
    deleteConversation: (id) => driver.deleteConversationSnapshot(id),
    updateConversationMetadata: (conversation) => driver.updateConversationMetadata(conversation),
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
    async deleteConversationSnapshot(id) {
      snapshots = snapshots.filter((currentSnapshot) => currentSnapshot.conversation.id !== id);
    },
    async updateConversationMetadata(conversation) {
      snapshots = snapshots.map((currentSnapshot) =>
        currentSnapshot.conversation.id === conversation.id ? { ...currentSnapshot, conversation } : currentSnapshot,
      );
    },
  };
}

export function createTauriPersistenceDriver(): PersistenceDriver {
  return {
    loadConversationSnapshots: () => invoke<ConversationSnapshot[]>("load_conversation_snapshots"),
    saveConversationSnapshot: (snapshot) => invoke<void>("save_conversation_snapshot", { snapshot }),
    deleteConversationSnapshot: (id) => invoke<void>("delete_conversation", { id }),
    updateConversationMetadata: (conversation) => invoke<void>("update_conversation_metadata", { conversation }),
  };
}

export function createDefaultConversationRepository(): ConversationRepository {
  const isTauri = "__TAURI_INTERNALS__" in window;
  return createConversationRepository(isTauri ? createTauriPersistenceDriver() : createMemoryPersistenceDriver());
}
