import { invoke } from "@tauri-apps/api/core";

export type LocalModelParseStatus = "parsed" | "partial" | "unreadable";

export interface LocalModel {
  id: string;
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  addedAt: string;
  architecture: string | null;
  quantization: string | null;
  contextLength: number | null;
  chatTemplate: string | null;
  parseStatus: LocalModelParseStatus;
}

export interface LocalModelDriver {
  importLocalModel: (filePath: string) => Promise<LocalModel>;
  loadLocalModels: () => Promise<LocalModel[]>;
  removeLocalModel: (id: string) => Promise<void>;
}

export type LocalModelRepository = LocalModelDriver;

export function createTauriLocalModelDriver(): LocalModelDriver {
  return {
    importLocalModel: (filePath) =>
      invoke<LocalModel>("import_local_model", {
        id: crypto.randomUUID(),
        filePath,
        addedAt: new Date().toISOString(),
      }),
    loadLocalModels: () => invoke<LocalModel[]>("load_local_models"),
    removeLocalModel: (id) => invoke<void>("remove_local_model", { id }),
  };
}

export function createMemoryLocalModelDriver(): LocalModelDriver {
  const models: LocalModel[] = [];

  return {
    async importLocalModel(filePath) {
      const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
      const model: LocalModel = {
        id: crypto.randomUUID(),
        fileName,
        filePath,
        fileSizeBytes: 0,
        addedAt: new Date().toISOString(),
        architecture: null,
        quantization: null,
        contextLength: null,
        chatTemplate: null,
        parseStatus: "unreadable",
      };
      models.unshift(model);
      return model;
    },
    async loadLocalModels() {
      return [...models];
    },
    async removeLocalModel(id) {
      const index = models.findIndex((model) => model.id === id);
      if (index !== -1) {
        models.splice(index, 1);
      }
    },
  };
}

export function createDefaultLocalModelRepository(): LocalModelRepository {
  const isTauri = "__TAURI_INTERNALS__" in window;
  return isTauri ? createTauriLocalModelDriver() : createMemoryLocalModelDriver();
}
