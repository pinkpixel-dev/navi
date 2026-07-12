use serde::Deserialize;
use serde_json::Value;
use std::collections::VecDeque;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const HEALTH_POLL_INTERVAL_MS: u64 = 500;
const HEALTH_POLL_TIMEOUT_SECS: u64 = 120;
const MAX_LOG_LINES: usize = 200;
const GITHUB_RELEASES_URL: &str = "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest";
const DEFAULT_GPU_LAYERS: u32 = 99;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeAcceleration {
    Auto,
    Cpu,
    Cuda,
    Vulkan,
    Rocm,
    Sycl,
}

impl RuntimeAcceleration {
    fn from_option(value: Option<&str>) -> Result<Self, String> {
        match value.unwrap_or("auto") {
            "auto" => Ok(Self::Auto),
            "cpu" => Ok(Self::Cpu),
            "cuda" => Ok(Self::Cuda),
            "vulkan" => Ok(Self::Vulkan),
            "rocm" => Ok(Self::Rocm),
            "sycl" => Ok(Self::Sycl),
            other => Err(format!("Unknown llama.cpp acceleration mode: {other}")),
        }
    }

    fn directory_name(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Cpu => "cpu",
            Self::Cuda => "cuda",
            Self::Vulkan => "vulkan",
            Self::Rocm => "rocm",
            Self::Sycl => "sycl",
        }
    }

    fn uses_gpu_layers(self) -> bool {
        !matches!(self, Self::Cpu)
    }
}

#[derive(Debug, Clone, PartialEq)]
enum RuntimeStatusState {
    Idle,
    Starting,
    Ready,
    Error,
}

impl RuntimeStatusState {
    fn as_str(&self) -> &'static str {
        match self {
            RuntimeStatusState::Idle => "idle",
            RuntimeStatusState::Starting => "starting",
            RuntimeStatusState::Ready => "ready",
            RuntimeStatusState::Error => "error",
        }
    }
}

struct RuntimeInner {
    child: Option<Child>,
    port: Option<u16>,
    model_id: Option<String>,
    state: RuntimeStatusState,
    message: Option<String>,
    logs: Arc<Mutex<VecDeque<String>>>,
}

impl Default for RuntimeInner {
    fn default() -> Self {
        Self {
            child: None,
            port: None,
            model_id: None,
            state: RuntimeStatusState::Idle,
            message: None,
            logs: Arc::new(Mutex::new(VecDeque::new())),
        }
    }
}

#[derive(Default)]
pub struct RuntimeState(Mutex<RuntimeInner>);

#[derive(Deserialize)]
struct ReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Deserialize)]
struct ReleaseResponse {
    tag_name: String,
    assets: Vec<ReleaseAsset>,
}

fn status_json(inner: &RuntimeInner) -> Value {
    serde_json::json!({
        "state": inner.state.as_str(),
        "port": inner.port,
        "modelId": inner.model_id,
        "message": inner.message,
    })
}

pub fn status(app: &AppHandle) -> Value {
    let state = app.state::<RuntimeState>();
    let inner = state.0.lock().unwrap();
    status_json(&inner)
}

fn patterns_for(
    os: &str,
    arch: &str,
    acceleration: RuntimeAcceleration,
) -> Result<Vec<&'static str>, String> {
    match (os, arch, acceleration) {
        ("linux", "x86_64", RuntimeAcceleration::Auto) => Ok(vec!["ubuntu-vulkan-x64"]),
        ("linux", "x86_64", RuntimeAcceleration::Cpu) => Ok(vec!["ubuntu-x64"]),
        ("linux", "x86_64", RuntimeAcceleration::Cuda) => Ok(vec!["ubuntu-cuda-x64"]),
        ("linux", "x86_64", RuntimeAcceleration::Vulkan) => Ok(vec!["ubuntu-vulkan-x64"]),
        ("linux", "x86_64", RuntimeAcceleration::Rocm) => Ok(vec!["ubuntu-rocm"]),
        ("linux", "x86_64", RuntimeAcceleration::Sycl) => {
            Ok(vec!["ubuntu-sycl-fp16-x64", "ubuntu-sycl-fp32-x64"])
        }
        ("macos", "aarch64", RuntimeAcceleration::Auto | RuntimeAcceleration::Cpu) => {
            Ok(vec!["macos-arm64"])
        }
        ("macos", "x86_64", RuntimeAcceleration::Auto | RuntimeAcceleration::Cpu) => {
            Ok(vec!["macos-x64"])
        }
        ("windows", "x86_64", RuntimeAcceleration::Auto) => Ok(vec![
            "win-cuda-13.3-x64",
            "win-cuda-12.4-x64",
            "win-vulkan-x64",
        ]),
        ("windows", "x86_64", RuntimeAcceleration::Cpu) => Ok(vec!["win-cpu-x64"]),
        ("windows", "x86_64", RuntimeAcceleration::Cuda) => {
            Ok(vec!["win-cuda-13.3-x64", "win-cuda-12.4-x64"])
        }
        ("windows", "x86_64", RuntimeAcceleration::Vulkan) => Ok(vec!["win-vulkan-x64"]),
        ("windows", "x86_64", RuntimeAcceleration::Rocm) => Ok(vec!["win-hip-radeon-x64"]),
        ("windows", "x86_64", RuntimeAcceleration::Sycl) => Ok(vec!["win-sycl-x64"]),
        ("windows", "aarch64", RuntimeAcceleration::Auto | RuntimeAcceleration::Cpu) => {
            Ok(vec!["win-cpu-arm64"])
        }
        (os, arch, _) => Err(format!("No known llama.cpp build for {os}/{arch}")),
    }
}

fn platform_asset_patterns(acceleration: RuntimeAcceleration) -> Result<Vec<&'static str>, String> {
    patterns_for(std::env::consts::OS, std::env::consts::ARCH, acceleration)
}

fn resolve_release_asset(acceleration: RuntimeAcceleration) -> Result<(String, String), String> {
    let patterns = platform_asset_patterns(acceleration)?;

    let body = ureq::get(GITHUB_RELEASES_URL)
        .set("User-Agent", "navi-app")
        .call()
        .map_err(|error| format!("Could not reach GitHub releases: {error}"))?
        .into_string()
        .map_err(|error| format!("Could not read GitHub release response: {error}"))?;

    let release: ReleaseResponse = serde_json::from_str(&body)
        .map_err(|error| format!("Could not parse GitHub release response: {error}"))?;

    let assets = release.assets;
    for pattern in &patterns {
        if let Some(asset) = assets.iter().find(|asset| asset.name.contains(pattern)) {
            return Ok((asset.browser_download_url.clone(), release.tag_name));
        }
    }

    Err(format!(
        "No llama.cpp release asset matching {} was found",
        patterns.join(", ")
    ))
}

fn runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate app data directory: {error}"))?;
    Ok(data_dir.join("llama-runtime"))
}

fn find_server_binary(dir: &Path) -> Option<PathBuf> {
    let name = if cfg!(windows) {
        "llama-server.exe"
    } else {
        "llama-server"
    };
    let mut stack = vec![dir.to_path_buf()];

    while let Some(current) = stack.pop() {
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.file_name().and_then(|value| value.to_str()) == Some(name) {
                return Some(path);
            }
        }
    }

    None
}

fn runtime_install_root(
    app: &AppHandle,
    acceleration: RuntimeAcceleration,
) -> Result<PathBuf, String> {
    Ok(runtime_root(app)?.join(acceleration.directory_name()))
}

pub fn is_downloaded(
    app: &AppHandle,
    binary_override: Option<&str>,
    acceleration: Option<&str>,
) -> bool {
    if let Some(path) = binary_override {
        if !path.is_empty() {
            return Path::new(path).exists();
        }
    }

    let acceleration =
        RuntimeAcceleration::from_option(acceleration).unwrap_or(RuntimeAcceleration::Auto);
    runtime_install_root(app, acceleration)
        .map(|root| find_server_binary(&root).is_some())
        .unwrap_or(false)
}

fn extract_tar_gz(bytes: Vec<u8>, dest: &Path) -> Result<(), String> {
    let cursor = std::io::Cursor::new(bytes);
    let decoder = flate2::read::GzDecoder::new(cursor);
    let mut archive = tar::Archive::new(decoder);
    archive
        .unpack(dest)
        .map_err(|error| format!("Could not extract runtime archive: {error}"))
}

fn extract_zip(bytes: Vec<u8>, dest: &Path) -> Result<(), String> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|error| format!("Could not open runtime archive: {error}"))?;

    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| format!("Could not read archive entry: {error}"))?;
        let Some(relative_path) = file.enclosed_name().map(|path| path.to_path_buf()) else {
            continue;
        };
        let out_path = dest.join(relative_path);

        if file.name().ends_with('/') {
            fs::create_dir_all(&out_path)
                .map_err(|error| format!("Could not create directory: {error}"))?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create directory: {error}"))?;
        }

        let mut out_file = fs::File::create(&out_path)
            .map_err(|error| format!("Could not write extracted file: {error}"))?;
        std::io::copy(&mut file, &mut out_file)
            .map_err(|error| format!("Could not extract file: {error}"))?;
    }

    Ok(())
}

pub fn download_and_extract(app: &AppHandle, acceleration: Option<&str>) -> Result<(), String> {
    let acceleration = RuntimeAcceleration::from_option(acceleration)?;
    let root = runtime_install_root(app, acceleration)?;
    if find_server_binary(&root).is_some() {
        return Ok(());
    }

    let (url, tag) = resolve_release_asset(acceleration)?;
    let dir = root.join(tag);
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create runtime directory: {error}"))?;

    let mut bytes = Vec::new();
    ureq::get(&url)
        .set("User-Agent", "navi-app")
        .call()
        .map_err(|error| format!("Could not download llama.cpp runtime: {error}"))?
        .into_reader()
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read downloaded archive: {error}"))?;

    if url.ends_with(".zip") {
        extract_zip(bytes, &dir)?;
    } else {
        extract_tar_gz(bytes, &dir)?;
    }

    let binary = find_server_binary(&dir)
        .ok_or_else(|| "Downloaded runtime archive did not contain llama-server".to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = fs::metadata(&binary) {
            let mut permissions = metadata.permissions();
            permissions.set_mode(permissions.mode() | 0o111);
            let _ = fs::set_permissions(&binary, permissions);
        }
    }

    Ok(())
}

fn resolve_binary_path(
    app: &AppHandle,
    binary_override: Option<&str>,
    acceleration: RuntimeAcceleration,
) -> Result<PathBuf, String> {
    if let Some(path) = binary_override {
        if !path.is_empty() {
            let path_buf = PathBuf::from(path);
            return if path_buf.exists() {
                Ok(path_buf)
            } else {
                Err(format!("Custom llama-server path does not exist: {path}"))
            };
        }
    }

    let root = runtime_install_root(app, acceleration)?;
    find_server_binary(&root).ok_or_else(|| "llama.cpp runtime is not downloaded yet".to_string())
}

fn pick_free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("Could not reserve a local port: {error}"))?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| format!("Could not read reserved port: {error}"))
}

fn spawn_log_reader<R: Read + Send + 'static>(
    reader: Option<R>,
    logs: Arc<Mutex<VecDeque<String>>>,
) {
    let Some(reader) = reader else {
        return;
    };

    thread::spawn(move || {
        let buffered = BufReader::new(reader);
        for line in buffered.lines().map_while(Result::ok) {
            let mut buffer = logs.lock().unwrap();
            if buffer.len() >= MAX_LOG_LINES {
                buffer.pop_front();
            }
            buffer.push_back(line);
        }
    });
}

fn wait_for_ready(app: &AppHandle, port: u16) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(HEALTH_POLL_TIMEOUT_SECS);
    let url = format!("http://127.0.0.1:{port}/health");

    while Instant::now() < deadline {
        {
            let state = app.state::<RuntimeState>();
            let mut inner = state.0.lock().unwrap();
            match inner.child.as_mut() {
                None => return Err("Startup was cancelled".to_string()),
                Some(child) => {
                    if let Ok(Some(_)) = child.try_wait() {
                        return Err("llama-server exited before becoming ready".to_string());
                    }
                }
            }
        }

        if let Ok(response) = ureq::get(&url).call() {
            if response.status() == 200 {
                return Ok(());
            }
        }

        thread::sleep(Duration::from_millis(HEALTH_POLL_INTERVAL_MS));
    }

    Err("Timed out waiting for llama-server to become ready".to_string())
}

pub fn start(
    app: &AppHandle,
    model_id: String,
    model_path: String,
    binary_override: Option<String>,
    acceleration: Option<&str>,
    gpu_layers: Option<u32>,
) -> Result<Value, String> {
    if !Path::new(&model_path).exists() {
        return Err(format!("Model file not found: {model_path}"));
    }

    let acceleration = RuntimeAcceleration::from_option(acceleration)?;
    let binary = resolve_binary_path(app, binary_override.as_deref(), acceleration)?;

    {
        let state = app.state::<RuntimeState>();
        let inner = state.0.lock().unwrap();
        if inner.state == RuntimeStatusState::Ready
            && inner.model_id.as_deref() == Some(model_id.as_str())
        {
            return Ok(status_json(&inner));
        }
    }

    stop(app)?;

    let port = pick_free_port()?;
    let mut command = Command::new(&binary);
    command
        .args([
            "-m",
            &model_path,
            "--port",
            &port.to_string(),
            "--host",
            "127.0.0.1",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if acceleration.uses_gpu_layers() {
        let layers = gpu_layers
            .unwrap_or(DEFAULT_GPU_LAYERS)
            .clamp(0, 999)
            .to_string();
        command.args(["--n-gpu-layers", &layers]);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start llama-server: {error}"))?;

    let logs: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::new()));
    spawn_log_reader(child.stdout.take(), Arc::clone(&logs));
    spawn_log_reader(child.stderr.take(), Arc::clone(&logs));

    {
        let state = app.state::<RuntimeState>();
        let mut inner = state.0.lock().unwrap();
        inner.child = Some(child);
        inner.port = Some(port);
        inner.model_id = Some(model_id);
        inner.state = RuntimeStatusState::Starting;
        inner.message = None;
        inner.logs = logs;
    }

    let outcome = wait_for_ready(app, port);

    let state = app.state::<RuntimeState>();
    let mut inner = state.0.lock().unwrap();

    match outcome {
        Ok(()) => {
            inner.state = RuntimeStatusState::Ready;
        }
        Err(reason) => {
            let recent_logs = {
                let buffer = inner.logs.lock().unwrap();
                buffer
                    .iter()
                    .rev()
                    .take(5)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(" | ")
            };
            if let Some(mut child) = inner.child.take() {
                let _ = child.kill();
            }
            inner.state = RuntimeStatusState::Error;
            inner.message = Some(if recent_logs.is_empty() {
                reason
            } else {
                format!("{reason} ({recent_logs})")
            });
        }
    }

    Ok(status_json(&inner))
}

pub fn stop(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<RuntimeState>();
    let mut inner = state.0.lock().unwrap();
    if let Some(mut child) = inner.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    inner.state = RuntimeStatusState::Idle;
    inner.port = None;
    inner.model_id = None;
    inner.message = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_a_free_port_that_is_bindable() {
        let port = pick_free_port().expect("should reserve a port");
        assert!(port > 0);
        TcpListener::bind(("127.0.0.1", port))
            .expect("port should be free again after the listener drops");
    }

    #[test]
    fn matches_known_platform_asset_patterns() {
        assert_eq!(
            patterns_for("linux", "x86_64", RuntimeAcceleration::Auto),
            Ok(vec!["ubuntu-vulkan-x64"])
        );
        assert_eq!(
            patterns_for("linux", "x86_64", RuntimeAcceleration::Cpu),
            Ok(vec!["ubuntu-x64"])
        );
        assert_eq!(
            patterns_for("linux", "x86_64", RuntimeAcceleration::Rocm),
            Ok(vec!["ubuntu-rocm"])
        );
        assert_eq!(
            patterns_for("windows", "x86_64", RuntimeAcceleration::Auto),
            Ok(vec![
                "win-cuda-13.3-x64",
                "win-cuda-12.4-x64",
                "win-vulkan-x64"
            ])
        );
        assert_eq!(
            patterns_for("macos", "aarch64", RuntimeAcceleration::Auto),
            Ok(vec!["macos-arm64"])
        );
        assert!(patterns_for("freebsd", "x86_64", RuntimeAcceleration::Auto).is_err());
    }

    #[test]
    fn log_reader_caps_buffered_lines() {
        let logs: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::new()));
        let data: String = (0..(MAX_LOG_LINES + 10))
            .map(|index| format!("line {index}\n"))
            .collect();
        let cursor = std::io::Cursor::new(data.into_bytes());
        spawn_log_reader(Some(cursor), Arc::clone(&logs));

        for _ in 0..100 {
            if logs.lock().unwrap().len() == MAX_LOG_LINES {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }

        assert_eq!(logs.lock().unwrap().len(), MAX_LOG_LINES);
    }
}
