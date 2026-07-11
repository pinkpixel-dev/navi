export type SubmitShortcut = "enter" | "shift-enter";

export interface AppSettings {
  submitShortcut: SubmitShortcut;
  lastModelId?: string;
}

export const defaultAppSettings: AppSettings = {
  submitShortcut: "enter",
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
