import type { AccentColor, AppSettings, SubmitShortcut, ThemeMode } from "../core/settings/appSettings";

interface GeneralSettingsProps {
  appSettings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

const accentColorOptions: { value: AccentColor; label: string }[] = [
  { value: "blue", label: "Blue" },
  { value: "red", label: "Red" },
  { value: "orange", label: "Orange" },
  { value: "yellow", label: "Yellow" },
  { value: "green", label: "Green" },
  { value: "purple", label: "Purple" },
  { value: "pink", label: "Pink" },
];

export function GeneralSettings({ appSettings, onChange }: GeneralSettingsProps) {
  return (
    <div className="settings-form settings-general">
      <h3>General</h3>
      <label>
        <span>Send message with</span>
        <select
          value={appSettings.submitShortcut}
          onChange={(event) => onChange({ ...appSettings, submitShortcut: event.target.value as SubmitShortcut })}
        >
          <option value="enter">Enter (Shift+Enter for a new line)</option>
          <option value="shift-enter">Shift+Enter (Enter for a new line)</option>
        </select>
      </label>
      <label>
        <span>Theme</span>
        <select
          value={appSettings.themeMode ?? "dark"}
          onChange={(event) => onChange({ ...appSettings, themeMode: event.target.value as ThemeMode })}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </label>
      <label>
        <span>Accent color</span>
        <select
          value={appSettings.accentColor ?? "blue"}
          onChange={(event) => onChange({ ...appSettings, accentColor: event.target.value as AccentColor })}
        >
          {accentColorOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
