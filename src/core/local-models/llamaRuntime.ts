import { invoke } from "@tauri-apps/api/core";

export type LocalRuntimeState = "idle" | "downloading" | "starting" | "ready" | "error";

export interface LocalRuntimeStatus {
  state: LocalRuntimeState;
  port: number | null;
  modelId: string | null;
  message: string | null;
}

export interface LlamaRuntimeDriver {
  isRuntimeDownloaded: (binaryOverride?: string) => Promise<boolean>;
  downloadRuntime: () => Promise<void>;
  startRuntime: (modelId: string, modelPath: string, binaryOverride?: string) => Promise<LocalRuntimeStatus>;
  stopRuntime: () => Promise<void>;
  getRuntimeStatus: () => Promise<LocalRuntimeStatus>;
}

export function createTauriLlamaRuntimeDriver(): LlamaRuntimeDriver {
  return {
    isRuntimeDownloaded: (binaryOverride) =>
      invoke<boolean>("is_local_runtime_downloaded", { binaryOverride: binaryOverride || undefined }),
    downloadRuntime: () => invoke<void>("download_local_runtime"),
    startRuntime: (modelId, modelPath, binaryOverride) =>
      invoke<LocalRuntimeStatus>("start_local_runtime", {
        modelId,
        modelPath,
        binaryOverride: binaryOverride || undefined,
      }),
    stopRuntime: () => invoke<void>("stop_local_runtime"),
    getRuntimeStatus: () => invoke<LocalRuntimeStatus>("get_local_runtime_status"),
  };
}

export function createUnsupportedLlamaRuntimeDriver(): LlamaRuntimeDriver {
  const unsupported = () =>
    Promise.reject(new Error("The local model runtime is only available in the desktop app."));

  return {
    isRuntimeDownloaded: () => Promise.resolve(false),
    downloadRuntime: unsupported,
    startRuntime: unsupported,
    stopRuntime: () => Promise.resolve(),
    getRuntimeStatus: () => Promise.resolve({ state: "idle", port: null, modelId: null, message: null }),
  };
}

export function createDefaultLlamaRuntimeDriver(): LlamaRuntimeDriver {
  const isTauri = "__TAURI_INTERNALS__" in window;
  return isTauri ? createTauriLlamaRuntimeDriver() : createUnsupportedLlamaRuntimeDriver();
}
