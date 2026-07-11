mod credentials;
mod storage;

use storage::{ConversationSnapshot, NaviStorage};
use tauri::{AppHandle, Manager};

#[tauri::command]
fn app_status() -> &'static str {
    "Navi desktop shell is ready."
}

fn storage_for_app(app: &AppHandle) -> Result<NaviStorage, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate app data directory: {error}"))?;
    NaviStorage::open(data_dir.join("navi.sqlite"))
        .map_err(|error| format!("Could not open Navi database: {error}"))
}

#[tauri::command]
fn save_conversation_snapshot(app: AppHandle, snapshot: ConversationSnapshot) -> Result<(), String> {
    storage_for_app(&app)?
        .save_conversation_snapshot(&snapshot)
        .map_err(|error| format!("Could not save conversation snapshot: {error}"))
}

#[tauri::command]
fn load_conversation_snapshots(app: AppHandle) -> Result<Vec<ConversationSnapshot>, String> {
    storage_for_app(&app)?
        .load_conversation_snapshots()
        .map_err(|error| format!("Could not load conversation snapshots: {error}"))
}

#[tauri::command]
fn save_provider_config(app: AppHandle, config: serde_json::Value) -> Result<(), String> {
    storage_for_app(&app)?
        .save_provider_config(&config)
        .map_err(|error| format!("Could not save provider config: {error}"))
}

#[tauri::command]
fn load_provider_configs(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    storage_for_app(&app)?
        .load_provider_configs()
        .map_err(|error| format!("Could not load provider configs: {error}"))
}

#[tauri::command]
fn save_provider_api_key(provider_id: String, api_key: String) -> Result<(), String> {
    credentials::save_provider_api_key(&provider_id, &api_key)
}

#[tauri::command]
fn get_provider_api_key(provider_id: String) -> Result<Option<String>, String> {
    credentials::get_provider_api_key(&provider_id)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            app_status,
            save_conversation_snapshot,
            load_conversation_snapshots,
            save_provider_config,
            load_provider_configs,
            save_provider_api_key,
            get_provider_api_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running Navi");
}
