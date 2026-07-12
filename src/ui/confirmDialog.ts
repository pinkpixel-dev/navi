import { confirm } from "@tauri-apps/plugin-dialog";

const isTauri = "__TAURI_INTERNALS__" in window;

/**
 * The webview's native `window.confirm` isn't wired up in the Tauri shell ("dialog.confirm
 * not allowed"), so destructive actions need to go through the dialog plugin's own confirm
 * command instead. Falls back to the real `window.confirm` in browser-dev mode, where it
 * works fine and the Tauri plugin bridge doesn't exist.
 */
export async function confirmDestructiveAction(message: string): Promise<boolean> {
  if (isTauri) {
    return confirm(message, { title: "Navi", kind: "warning" });
  }
  return window.confirm(message);
}
