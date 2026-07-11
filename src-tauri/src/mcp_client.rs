use rmcp::model::{ClientCapabilities, ClientInfo, Implementation};
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use rmcp::transport::{ConfigureCommandExt, StreamableHttpClientTransport, TokioChildProcess};
use rmcp::{Peer, RoleClient, ServiceExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use tauri::AppHandle;
use tokio::process::Command;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub transport: String,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Option<Vec<String>>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: Option<HashMap<String, String>>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
}

fn default_enabled() -> bool {
    true
}

#[derive(Default)]
pub struct McpManagerState(Mutex<HashMap<String, Peer<RoleClient>>>);

fn client_info() -> ClientInfo {
    ClientInfo::new(
        ClientCapabilities::default(),
        Implementation::new("Navi", env!("CARGO_PKG_VERSION")),
    )
}

fn build_stdio_command(config: &McpServerConfig) -> Result<Command, String> {
    let command_name = config
        .command
        .clone()
        .ok_or_else(|| "Stdio MCP servers need a command".to_string())?;
    let args = config.args.clone().unwrap_or_default();
    let cwd = config.cwd.clone();
    let env = config.env.clone().unwrap_or_default();

    Ok(Command::new(command_name).configure(|cmd| {
        cmd.args(&args);
        if let Some(cwd) = &cwd {
            cmd.current_dir(cwd);
        }
        cmd.envs(&env);
    }))
}

fn build_http_transport(
    config: &McpServerConfig,
) -> Result<StreamableHttpClientTransport<reqwest::Client>, String> {
    let url = config
        .url
        .clone()
        .ok_or_else(|| "HTTP MCP servers need a URL".to_string())?;

    let mut transport_config = StreamableHttpClientTransportConfig::with_uri(url);

    if let Some(headers) = &config.headers {
        let mut header_map: HashMap<http::HeaderName, http::HeaderValue> = HashMap::new();
        for (key, value) in headers {
            let name = http::HeaderName::try_from(key.as_str())
                .map_err(|error| format!("Invalid header name '{key}': {error}"))?;
            let val = http::HeaderValue::try_from(value.as_str())
                .map_err(|error| format!("Invalid header value for '{key}': {error}"))?;
            header_map.insert(name, val);
        }
        transport_config = transport_config.custom_headers(header_map);
    }

    Ok(StreamableHttpClientTransport::with_client(
        reqwest::Client::new(),
        transport_config,
    ))
}

async fn discover(peer: &Peer<RoleClient>) -> Value {
    let tools = peer.list_all_tools().await.unwrap_or_default();
    let resources = peer.list_all_resources().await.unwrap_or_default();
    let prompts = peer.list_all_prompts().await.unwrap_or_default();
    let peer_info = peer.peer_info();
    let instructions = peer_info.as_ref().and_then(|info| info.instructions.clone());

    serde_json::json!({
        "state": "connected",
        "message": Value::Null,
        "instructions": instructions,
        "tools": tools,
        "resources": resources,
        "prompts": prompts,
    })
}

pub async fn test_connection(config: McpServerConfig) -> Result<Value, String> {
    match config.transport.as_str() {
        "stdio" => {
            let command = build_stdio_command(&config)?;
            let transport = TokioChildProcess::new(command)
                .map_err(|error| format!("Could not start MCP server process: {error}"))?;
            let running = client_info()
                .serve(transport)
                .await
                .map_err(|error| format!("Could not connect to MCP server: {error}"))?;
            let status = discover(running.peer()).await;
            let _ = running.cancel().await;
            Ok(status)
        }
        "http" => {
            let transport = build_http_transport(&config)?;
            let running = client_info()
                .serve(transport)
                .await
                .map_err(|error| format!("Could not connect to MCP server: {error}"))?;
            let status = discover(running.peer()).await;
            let _ = running.cancel().await;
            Ok(status)
        }
        other => Err(format!("Unknown MCP transport type: {other}")),
    }
}

pub async fn connect(app: &AppHandle, config: McpServerConfig) -> Result<Value, String> {
    use tauri::Manager;

    let peer = match config.transport.as_str() {
        "stdio" => {
            let command = build_stdio_command(&config)?;
            let transport = TokioChildProcess::new(command)
                .map_err(|error| format!("Could not start MCP server process: {error}"))?;
            let running = client_info()
                .serve(transport)
                .await
                .map_err(|error| format!("Could not connect to MCP server: {error}"))?;
            let peer = running.peer().clone();
            tokio::spawn(async move {
                let _ = running.waiting().await;
            });
            peer
        }
        "http" => {
            let transport = build_http_transport(&config)?;
            let running = client_info()
                .serve(transport)
                .await
                .map_err(|error| format!("Could not connect to MCP server: {error}"))?;
            let peer = running.peer().clone();
            tokio::spawn(async move {
                let _ = running.waiting().await;
            });
            peer
        }
        other => return Err(format!("Unknown MCP transport type: {other}")),
    };

    let status = discover(&peer).await;

    let state = app.state::<McpManagerState>();
    let mut connections = state.0.lock().await;
    connections.insert(config.id.clone(), peer);

    Ok(status)
}

pub async fn disconnect(app: &AppHandle, id: &str) -> Result<(), String> {
    use tauri::Manager;

    let state = app.state::<McpManagerState>();
    let mut connections = state.0.lock().await;
    connections.remove(id);
    Ok(())
}

pub async fn status(app: &AppHandle, id: &str) -> Value {
    use tauri::Manager;

    let state = app.state::<McpManagerState>();
    let connections = state.0.lock().await;

    match connections.get(id) {
        Some(peer) => discover(peer).await,
        None => serde_json::json!({
            "state": "idle",
            "message": Value::Null,
            "instructions": Value::Null,
            "tools": [],
            "resources": [],
            "prompts": [],
        }),
    }
}
