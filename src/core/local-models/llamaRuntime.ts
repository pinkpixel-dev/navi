import { invoke } from "@tauri-apps/api/core";

export type LocalRuntimeState = "idle" | "downloading" | "starting" | "ready" | "error";

export interface LocalRuntimeStatus {
  state: LocalRuntimeState;
  port: number | null;
  modelId: string | null;
  message: string | null;
}

export type LocalRuntimeAcceleration = "auto" | "cpu" | "cuda" | "vulkan" | "rocm" | "sycl";

export interface LocalRuntimeUpdateInfo {
  /** Release tag of the build currently in use, e.g. "b7891". */
  installedVersion: string | null;
  /** Newest release tag published by llama.cpp, or null if the check could not run. */
  latestVersion: string | null;
  updateAvailable: boolean;
  /** Unix seconds of the last successful check. */
  checkedAt: number | null;
  /** True when a custom llama-server path is set, which Navi does not manage. */
  usingCustomBinary: boolean;
  /** Why the check failed, when it did. Background checks stay silent on this. */
  message: string | null;
}

export const unknownRuntimeUpdateInfo: LocalRuntimeUpdateInfo = {
  installedVersion: null,
  latestVersion: null,
  updateAvailable: false,
  checkedAt: null,
  usingCustomBinary: false,
  message: null,
};

export interface LlamaRuntimeDriver {
  isRuntimeDownloaded: (binaryOverride?: string, acceleration?: LocalRuntimeAcceleration) => Promise<boolean>;
  downloadRuntime: (acceleration?: LocalRuntimeAcceleration) => Promise<void>;
  checkRuntimeUpdate: (
    binaryOverride?: string,
    acceleration?: LocalRuntimeAcceleration,
    force?: boolean,
  ) => Promise<LocalRuntimeUpdateInfo>;
  updateRuntime: (acceleration?: LocalRuntimeAcceleration) => Promise<LocalRuntimeUpdateInfo>;
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
    checkRuntimeUpdate: (binaryOverride, acceleration, force) =>
      invoke<LocalRuntimeUpdateInfo>("check_local_runtime_update", {
        binaryOverride: binaryOverride || undefined,
        acceleration: acceleration || "auto",
        force: force ?? false,
      }),
    updateRuntime: (acceleration) =>
      invoke<LocalRuntimeUpdateInfo>("update_local_runtime", { acceleration: acceleration || "auto" }),
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
    checkRuntimeUpdate: () => Promise.resolve(unknownRuntimeUpdateInfo),
    updateRuntime: unsupported,
    startRuntime: unsupported,
    stopRuntime: () => Promise.resolve(),
    getRuntimeStatus: () => Promise.resolve({ state: "idle", port: null, modelId: null, message: null }),
  };
}

export function createDefaultLlamaRuntimeDriver(): LlamaRuntimeDriver {
  const isTauri = "__TAURI_INTERNALS__" in window;
  return isTauri ? createTauriLlamaRuntimeDriver() : createUnsupportedLlamaRuntimeDriver();
}
