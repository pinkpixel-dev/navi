import type { ProjectSettings } from "../projects/projectSettings";

export type SubmitShortcut = "enter" | "shift-enter";
export type ThemeMode = "dark" | "light";
export type AccentColor = "blue" | "red" | "orange" | "yellow" | "green" | "purple" | "pink";

export interface AppSettings {
  submitShortcut: SubmitShortcut;
  themeMode?: ThemeMode;
  accentColor?: AccentColor;
  lastModelId?: string;
  userName?: string;
  userBio?: string;
  userInstructions?: string;
  projects?: ProjectSettings[];
  customLlamaServerPath?: string;
  localRuntimeAcceleration?: "auto" | "cpu" | "cuda" | "vulkan" | "rocm" | "sycl";
  localRuntimeGpuLayers?: number;
  /** Data-URI avatar overrides; the bundled user.png/assistant.png are used when unset. */
  userAvatar?: string;
  assistantAvatar?: string;
}

export const defaultAppSettings: AppSettings = {
  submitShortcut: "enter",
  themeMode: "dark",
  accentColor: "blue",
};

const appSettingsStorageKey = "navi.appSettings";

export function loadAppSettings(): AppSettings {
  if (typeof window === "undefined" || !("localStorage" in window)) {
    return defaultAppSettings;
  }

  const rawValue = window.localStorage.getItem(appSettingsStorageKey);
  if (!rawValue) {
    return defaultAppSettings;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<AppSettings>;
    return { ...defaultAppSettings, ...parsed };
  } catch {
    return defaultAppSettings;
  }
}

export function saveAppSettings(settings: AppSettings): void {
  if (typeof window === "undefined" || !("localStorage" in window)) {
    return;
  }

  window.localStorage.setItem(appSettingsStorageKey, JSON.stringify(settings));
}
