import { invoke } from "@tauri-apps/api/core";

export type LocalRuntimeState = "idle" | "downloading" | "starting" | "ready" | "error";

export interface LocalRuntimeStatus {
  state: LocalRuntimeState;
  port: number | null;
  modelId: string | null;
  message: string | null;
}

export type LocalRuntimeAcceleration = "auto" | "cpu" | "cuda" | "vulkan" | "rocm" | "sycl";

export interface LlamaRuntimeDriver {
  isRuntimeDownloaded: (binaryOverride?: string, acceleration?: LocalRuntimeAcceleration) => Promise<boolean>;
  downloadRuntime: (acceleration?: LocalRuntimeAcceleration) => Promise<void>;
  startRuntime: (
    modelId: string,
    modelPath: string,
    binaryOverride?: string,
    acceleration?: LocalRuntimeAcceleration,
    gpuLayers?: number,
  ) => Promise<LocalRuntimeStatus>;
  stopRuntime: () => Promise<void>;
  getRuntimeStatus: () => Promise<LocalRuntimeStatus>;
}

export function createTauriLlamaRuntimeDriver(): LlamaRuntimeDriver {
  return {
    isRuntimeDownloaded: (binaryOverride, acceleration) =>
      invoke<boolean>("is_local_runtime_downloaded", {
        binaryOverride: binaryOverride || undefined,
        acceleration: acceleration || "auto",
      }),
    downloadRuntime: (acceleration) => invoke<void>("download_local_runtime", { acceleration: acceleration || "auto" }),
    startRuntime: (modelId, modelPath, binaryOverride, acceleration, gpuLayers) =>
      invoke<LocalRuntimeStatus>("start_local_runtime", {
        modelId,
        modelPath,
        binaryOverride: binaryOverride || undefined,
        acceleration: acceleration || "auto",
        gpuLayers,
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
