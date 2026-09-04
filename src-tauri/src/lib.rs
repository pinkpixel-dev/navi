mod credentials;
mod gguf;
mod llama_runtime;
mod mcp_client;
mod storage;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use storage::{ConversationSnapshot, NaviStorage};
use tauri::{AppHandle, Manager};

#[tauri::command]
fn app_status() -> &'static str {
    "Navi desktop shell is ready."
}

#[derive(Debug, Deserialize)]
struct LocalHttpRequest {
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
}

#[derive(Debug, Serialize)]
struct LocalHttpResponse {
    status: u16,
    body: String,
}

fn is_loopback_http_url(url: &reqwest::Url) -> bool {
    url.scheme() == "http"
        && matches!(
            url.host_str(),
            Some("localhost") | Some("127.0.0.1") | Some("::1")
        )
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
async fn local_http_request(request: LocalHttpRequest) -> Result<LocalHttpResponse, String> {
    let url =
        reqwest::Url::parse(&request.url).map_err(|error| format!("Invalid local URL: {error}"))?;
    if !is_loopback_http_url(&url) {
        return Err("Only loopback HTTP URLs are allowed for local provider requests.".to_string());
    }

    let method = request
        .method
        .as_deref()
        .unwrap_or("GET")
        .parse::<reqwest::Method>()
        .map_err(|error| format!("Invalid local request method: {error}"))?;
    let client = reqwest::Client::new();
    let mut builder = client.request(method, url);

    for (name, value) in request.headers.unwrap_or_default() {
        builder = builder.header(name, value);
    }

    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let response = builder
        .send()
        .await
        .map_err(|error| format!("Local provider request failed: {error}"))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Could not read local provider response: {error}"))?;

    Ok(LocalHttpResponse { status, body })
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
fn delete_conversation(app: AppHandle, id: String) -> Result<(), String> {
    storage_for_app(&app)?
        .delete_conversation(&id)
        .map_err(|error| format!("Could not delete conversation: {error}"))
}

#[tauri::command]
fn update_conversation_metadata(app: AppHandle, conversation: serde_json::Value) -> Result<(), String> {
    storage_for_app(&app)?
        .update_conversation_metadata(&conversation)
        .map_err(|error| format!("Could not update conversation: {error}"))
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
fn remove_provider_config(app: AppHandle, provider_id: String) -> Result<(), String> {
    storage_for_app(&app)?
        .delete_provider_config(&provider_id)
        .map_err(|error| format!("Could not remove provider config: {error}"))
}

#[tauri::command]
fn save_provider_api_key(provider_id: String, api_key: String) -> Result<(), String> {
    credentials::save_provider_api_key(&provider_id, &api_key)
}

#[tauri::command]
fn get_provider_api_key(provider_id: String) -> Result<Option<String>, String> {
    credentials::get_provider_api_key(&provider_id)
}

#[tauri::command]
fn import_local_model(
    app: AppHandle,
    id: String,
    file_path: String,
    added_at: String,
) -> Result<serde_json::Value, String> {
    let path = std::path::Path::new(&file_path);
    let file_metadata = std::fs::metadata(path).map_err(|error| format!("Could not read model file: {error}"))?;
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| file_path.clone());
    let gguf_metadata = gguf::read_gguf_metadata(path);

    let record = serde_json::json!({
        "id": id,
        "fileName": file_name,
        "filePath": file_path,
        "fileSizeBytes": file_metadata.len(),
        "addedAt": added_at,
        "architecture": gguf_metadata.architecture,
        "quantization": gguf_metadata.quantization,
        "contextLength": gguf_metadata.context_length,
        "chatTemplate": gguf_metadata.chat_template,
        "parseStatus": gguf_metadata.parse_status,
    });

    storage_for_app(&app)?
        .save_local_model(&record)
        .map_err(|error| format!("Could not save local model: {error}"))?;

    Ok(record)
}

#[tauri::command]
fn load_local_models(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    storage_for_app(&app)?
        .load_local_models()
        .map_err(|error| format!("Could not load local models: {error}"))
}

#[tauri::command]
fn remove_local_model(app: AppHandle, id: String) -> Result<(), String> {
    storage_for_app(&app)?
        .delete_local_model(&id)
        .map_err(|error| format!("Could not remove local model: {error}"))
}

#[tauri::command]
fn is_local_runtime_downloaded(app: AppHandle, binary_override: Option<String>, acceleration: Option<String>) -> bool {
    llama_runtime::is_downloaded(&app, binary_override.as_deref(), acceleration.as_deref())
}

#[tauri::command]
fn download_local_runtime(app: AppHandle, acceleration: Option<String>) -> Result<(), String> {
    llama_runtime::download_and_extract(&app, acceleration.as_deref())
}

#[tauri::command]
fn check_local_runtime_update(
    app: AppHandle,
    binary_override: Option<String>,
    acceleration: Option<String>,
    force: Option<bool>,
) -> Result<serde_json::Value, String> {
    llama_runtime::update_info(
        &app,
        binary_override.as_deref(),
        acceleration.as_deref(),
        force.unwrap_or(false),
    )
}

#[tauri::command]
fn update_local_runtime(
    app: AppHandle,
    acceleration: Option<String>,
) -> Result<serde_json::Value, String> {
    llama_runtime::install_update(&app, acceleration.as_deref())
}

#[tauri::command]
fn start_local_runtime(
    app: AppHandle,
    model_id: String,
    model_path: String,
    binary_override: Option<String>,
    acceleration: Option<String>,
    gpu_layers: Option<u32>,
) -> Result<serde_json::Value, String> {
    llama_runtime::start(&app, model_id, model_path, binary_override, acceleration.as_deref(), gpu_layers)
}

#[tauri::command]
fn stop_local_runtime(app: AppHandle) -> Result<(), String> {
    llama_runtime::stop(&app)
}

#[tauri::command]
fn get_local_runtime_status(app: AppHandle) -> serde_json::Value {
    llama_runtime::status(&app)
}

#[tauri::command]
fn write_binary_file(path: String, contents_base64: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(contents_base64)
        .map_err(|error| format!("Could not decode file contents: {error}"))?;
    std::fs::write(&path, bytes).map_err(|error| format!("Could not write {path}: {error}"))
}

#[tauri::command]
fn read_binary_file(path: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = std::fs::read(&path).map_err(|error| format!("Could not read {path}: {error}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
fn save_mcp_server(app: AppHandle, config: mcp_client::McpServerConfig) -> Result<(), String> {
    let value = serde_json::to_value(&config).map_err(|error| format!("Could not encode MCP server config: {error}"))?;
    storage_for_app(&app)?
        .save_mcp_server(&value)
        .map_err(|error| format!("Could not save MCP server: {error}"))
}

#[tauri::command]
fn load_mcp_servers(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    storage_for_app(&app)?
        .load_mcp_servers()
        .map_err(|error| format!("Could not load MCP servers: {error}"))
}

#[tauri::command]
fn remove_mcp_server(app: AppHandle, id: String) -> Result<(), String> {
    storage_for_app(&app)?
        .delete_mcp_server(&id)
        .map_err(|error| format!("Could not remove MCP server: {error}"))
}

#[tauri::command]
async fn test_mcp_connection(config: mcp_client::McpServerConfig) -> Result<serde_json::Value, String> {
    mcp_client::test_connection(config).await
}

#[tauri::command]
async fn connect_mcp_server(app: AppHandle, config: mcp_client::McpServerConfig) -> Result<serde_json::Value, String> {
    mcp_client::connect(&app, config).await
}

#[tauri::command]
async fn disconnect_mcp_server(app: AppHandle, id: String) -> Result<(), String> {
    mcp_client::disconnect(&app, &id).await
}

#[tauri::command]
async fn get_mcp_server_status(app: AppHandle, id: String) -> serde_json::Value {
    mcp_client::status(&app, &id).await
}

#[tauri::command]
async fn call_mcp_tool(
    app: AppHandle,
    server_id: String,
    tool_name: String,
    arguments: serde_json::Value,
) -> Result<serde_json::Value, String> {
    mcp_client::call_tool(&app, &server_id, tool_name, arguments).await
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(llama_runtime::RuntimeState::default())
        .manage(mcp_client::McpManagerState::default())
        .invoke_handler(tauri::generate_handler![
            app_status,
            local_http_request,
            save_conversation_snapshot,
            load_conversation_snapshots,
            delete_conversation,
            update_conversation_metadata,
            save_provider_config,
            load_provider_configs,
            remove_provider_config,
            save_provider_api_key,
            get_provider_api_key,
            import_local_model,
            load_local_models,
            remove_local_model,
            is_local_runtime_downloaded,
            download_local_runtime,
            check_local_runtime_update,
            update_local_runtime,
            start_local_runtime,
            stop_local_runtime,
            get_local_runtime_status,
            write_binary_file,
            read_binary_file,
            save_mcp_server,
            load_mcp_servers,
            remove_mcp_server,
            test_mcp_connection,
            connect_mcp_server,
            disconnect_mcp_server,
            get_mcp_server_status,
            call_mcp_tool
        ])
        .build(tauri::generate_context!())
        .expect("error while building Navi")
        .run(|app_handle, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
                let _ = llama_runtime::stop(app_handle);
            }
        });
}
