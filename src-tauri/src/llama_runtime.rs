use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::VecDeque;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const HEALTH_POLL_INTERVAL_MS: u64 = 500;
const HEALTH_POLL_TIMEOUT_SECS: u64 = 120;
const MAX_LOG_LINES: usize = 200;
/// llama.cpp publishes its `b<build>` binaries as GitHub *prereleases* and keeps
/// the "latest" release for a semver tag that ships no binaries at all, so we list
/// releases and pick the newest usable build ourselves.
const GITHUB_RELEASES_URL: &str =
    "https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=30";
const DEFAULT_GPU_LAYERS: u32 = 99;
/// How long a cached "latest release" answer stays good before we ask GitHub again.
const UPDATE_CHECK_INTERVAL_SECS: u64 = 60 * 60 * 24;
/// The current build plus one previous build, so a bad update can be rolled back.
const KEEP_INSTALLED_BUILDS: usize = 2;
const UPDATE_CACHE_FILE: &str = "update-check.json";

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

#[derive(Serialize, Deserialize)]
struct UpdateCheckCache {
    checked_at: u64,
    latest_tag: String,
}

struct InstalledBuild {
    tag: String,
    dir: PathBuf,
    binary: PathBuf,
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

/// llama.cpp tags its releases `b<build number>`, so ordering is numeric when we
/// recognise the shape and falls back to plain string ordering when we do not.
fn build_number(tag: &str) -> Option<u64> {
    tag.strip_prefix('b')?.parse::<u64>().ok()
}

fn build_sort_key(tag: &str) -> (u64, String) {
    (build_number(tag).unwrap_or(0), tag.to_string())
}

fn is_newer_build(candidate: &str, installed: &str) -> bool {
    match (build_number(candidate), build_number(installed)) {
        (Some(candidate), Some(installed)) => candidate > installed,
        // A tag we cannot read as a build number is a tag we cannot install, so it
        // never counts as an available update.
        _ => false,
    }
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
        ("windows", "x86_64", RuntimeAcceleration::Rocm) => Ok(vec!["win-rocm"]),
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

/// Keeps only the `b<build>` releases and puts the newest first.
fn build_releases(releases: Vec<ReleaseResponse>) -> Vec<ReleaseResponse> {
    let mut builds: Vec<ReleaseResponse> = releases
        .into_iter()
        .filter(|release| build_number(&release.tag_name).is_some())
        .collect();
    builds.sort_by_key(|release| std::cmp::Reverse(build_sort_key(&release.tag_name)));
    builds
}

fn fetch_build_releases() -> Result<Vec<ReleaseResponse>, String> {
    let body = ureq::get(GITHUB_RELEASES_URL)
        .set("User-Agent", "navi-app")
        .call()
        .map_err(|error| format!("Could not reach GitHub releases: {error}"))?
        .into_string()
        .map_err(|error| format!("Could not read GitHub release response: {error}"))?;

    let releases: Vec<ReleaseResponse> = serde_json::from_str(&body)
        .map_err(|error| format!("Could not parse GitHub release response: {error}"))?;

    Ok(build_releases(releases))
}

/// Every runtime archive is named `llama-<build>-bin-<platform>`. The prefix matters:
/// a CUDA release also ships `cudart-llama-bin-win-cuda-13.3-x64.zip`, the NVIDIA
/// redistributable, which contains no llama-server and sorts ahead of the build we want.
fn is_runtime_asset(name: &str, pattern: &str) -> bool {
    name.starts_with("llama-") && name.contains(pattern)
}

/// The newest build that actually ships an archive for this platform. Walking past
/// a build whose asset is missing keeps a single incomplete nightly from blocking
/// updates, and means a build we advertise is always one we can install.
fn find_release_asset<'a>(
    releases: &'a [ReleaseResponse],
    patterns: &[&str],
) -> Option<(&'a ReleaseResponse, &'a ReleaseAsset)> {
    releases.iter().find_map(|release| {
        patterns.iter().find_map(|pattern| {
            release
                .assets
                .iter()
                .find(|asset| is_runtime_asset(&asset.name, pattern))
                .map(|asset| (release, asset))
        })
    })
}

fn resolve_release_asset(acceleration: RuntimeAcceleration) -> Result<(String, String), String> {
    let patterns = platform_asset_patterns(acceleration)?;
    let releases = fetch_build_releases()?;
    if releases.is_empty() {
        return Err("GitHub returned no llama.cpp build releases".to_string());
    }

    let (release, asset) = find_release_asset(&releases, &patterns).ok_or_else(|| {
        format!(
            "No llama.cpp release asset matching {} was found in the {} most recent builds",
            patterns.join(", "),
            releases.len()
        )
    })?;

    Ok((asset.browser_download_url.clone(), release.tag_name.clone()))
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

/// Every downloaded build under an acceleration root, newest first. Each build
/// lives in a directory named after its release tag.
fn installed_builds(root: &Path) -> Vec<InstalledBuild> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };

    let mut builds: Vec<InstalledBuild> = entries
        .flatten()
        .filter_map(|entry| {
            let dir = entry.path();
            if !dir.is_dir() {
                return None;
            }
            let tag = dir.file_name()?.to_str()?.to_string();
            let binary = find_server_binary(&dir)?;
            Some(InstalledBuild { tag, dir, binary })
        })
        .collect();

    builds.sort_by_key(|build| std::cmp::Reverse(build_sort_key(&build.tag)));
    builds
}

fn active_build(root: &Path) -> Option<InstalledBuild> {
    installed_builds(root).into_iter().next()
}

fn runtime_is_running(app: &AppHandle) -> bool {
    let state = app.state::<RuntimeState>();
    let inner = state.0.lock().unwrap();
    inner.child.is_some()
}

/// Drops builds beyond the newest `KEEP_INSTALLED_BUILDS`. Skipped while a model
/// is running so we never delete the binary out from under a live process; the
/// next update pass cleans up instead.
fn prune_old_builds(app: &AppHandle, root: &Path) {
    if runtime_is_running(app) {
        return;
    }

    for build in installed_builds(root).into_iter().skip(KEEP_INSTALLED_BUILDS) {
        let _ = fs::remove_dir_all(&build.dir);
    }
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

fn install_release(root: &Path, url: &str, tag: &str) -> Result<(), String> {
    let dir = root.join(tag);
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create runtime directory: {error}"))?;

    let mut bytes = Vec::new();
    ureq::get(url)
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

pub fn download_and_extract(app: &AppHandle, acceleration: Option<&str>) -> Result<(), String> {
    let acceleration = RuntimeAcceleration::from_option(acceleration)?;
    let root = runtime_install_root(app, acceleration)?;
    if find_server_binary(&root).is_some() {
        return Ok(());
    }

    let (url, tag) = resolve_release_asset(acceleration)?;
    install_release(&root, &url, &tag)?;
    write_update_cache(app, &tag);
    Ok(())
}

fn update_cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(runtime_root(app)?.join(UPDATE_CACHE_FILE))
}

fn read_update_cache(app: &AppHandle) -> Option<UpdateCheckCache> {
    let path = update_cache_path(app).ok()?;
    let body = fs::read_to_string(path).ok()?;
    serde_json::from_str(&body).ok()
}

fn write_update_cache(app: &AppHandle, latest_tag: &str) {
    let Ok(path) = update_cache_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let cache = UpdateCheckCache {
        checked_at: now_unix(),
        latest_tag: latest_tag.to_string(),
    };
    if let Ok(body) = serde_json::to_string(&cache) {
        let _ = fs::write(path, body);
    }
}

fn update_info_json(
    installed: Option<&str>,
    latest: Option<&str>,
    checked_at: Option<u64>,
    using_custom_binary: bool,
    message: Option<String>,
) -> Value {
    let update_available = match (installed, latest) {
        (Some(installed), Some(latest)) if !using_custom_binary => {
            is_newer_build(latest, installed)
        }
        _ => false,
    };

    serde_json::json!({
        "installedVersion": installed,
        "latestVersion": latest,
        "updateAvailable": update_available,
        "checkedAt": checked_at,
        "usingCustomBinary": using_custom_binary,
        "message": message,
    })
}

/// Reports the installed build against the newest published one. Network calls are
/// cached for `UPDATE_CHECK_INTERVAL_SECS` unless `force` is set, so the automatic
/// check on opening settings costs nothing most of the time. A failed lookup is
/// reported through `message` rather than as an error, so a background check can
/// stay quiet when the machine is offline.
pub fn update_info(
    app: &AppHandle,
    binary_override: Option<&str>,
    acceleration: Option<&str>,
    force: bool,
) -> Result<Value, String> {
    if let Some(path) = binary_override {
        if !path.is_empty() {
            return Ok(update_info_json(None, None, None, true, None));
        }
    }

    let acceleration = RuntimeAcceleration::from_option(acceleration)?;
    let root = runtime_install_root(app, acceleration)?;
    let installed = active_build(&root).map(|build| build.tag);

    let cached = read_update_cache(app);
    let now = now_unix();
    let is_fresh = cached
        .as_ref()
        .map(|cache| now.saturating_sub(cache.checked_at) < UPDATE_CHECK_INTERVAL_SECS)
        .unwrap_or(false);

    if !force && is_fresh {
        let cache = cached.expect("a fresh cache is present");
        return Ok(update_info_json(
            installed.as_deref(),
            Some(&cache.latest_tag),
            Some(cache.checked_at),
            false,
            None,
        ));
    }

    match resolve_release_asset(acceleration) {
        Ok((_, tag)) => {
            write_update_cache(app, &tag);
            Ok(update_info_json(
                installed.as_deref(),
                Some(&tag),
                Some(now),
                false,
                None,
            ))
        }
        Err(error) => Ok(update_info_json(
            installed.as_deref(),
            cached.as_ref().map(|cache| cache.latest_tag.as_str()),
            cached.as_ref().map(|cache| cache.checked_at),
            false,
            Some(error),
        )),
    }
}

/// Downloads the newest published build alongside the current one, then prunes
/// anything older than the builds we keep for rollback.
pub fn install_update(app: &AppHandle, acceleration: Option<&str>) -> Result<Value, String> {
    let acceleration_mode = RuntimeAcceleration::from_option(acceleration)?;
    let root = runtime_install_root(app, acceleration_mode)?;
    let (url, tag) = resolve_release_asset(acceleration_mode)?;
    write_update_cache(app, &tag);

    let already_installed = installed_builds(&root)
        .iter()
        .any(|build| build.tag == tag);

    if !already_installed {
        // Clear any half-extracted directory left behind by an interrupted download.
        let _ = fs::remove_dir_all(root.join(&tag));
        install_release(&root, &url, &tag)?;
        prune_old_builds(app, &root);
    }

    update_info(app, None, acceleration, false)
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
    if let Some(build) = active_build(&root) {
        return Ok(build.binary);
    }

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
            patterns_for("windows", "x86_64", RuntimeAcceleration::Rocm),
            Ok(vec!["win-rocm"])
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
    fn orders_release_tags_by_build_number() {
        assert_eq!(build_number("b7891"), Some(7891));
        assert_eq!(build_number("master-abc123"), None);
        assert!(build_sort_key("b7950") > build_sort_key("b7891"));
        assert!(build_sort_key("b10000") > build_sort_key("b9999"));
    }

    #[test]
    fn detects_newer_builds_without_downgrading() {
        assert!(is_newer_build("b7950", "b7891"));
        assert!(!is_newer_build("b7891", "b7950"));
        assert!(!is_newer_build("b7891", "b7891"));
        // A semver release such as `v0.3.0` carries no binaries, so it is never an
        // update even though the tag differs from the installed one.
        assert!(!is_newer_build("v0.3.0", "b7891"));
        assert!(!is_newer_build("master-abc", "b7891"));
    }

    fn release(tag: &str, asset_names: &[&str]) -> ReleaseResponse {
        ReleaseResponse {
            tag_name: tag.to_string(),
            assets: asset_names
                .iter()
                .map(|name| ReleaseAsset {
                    name: (*name).to_string(),
                    browser_download_url: format!("https://example.test/{tag}/{name}"),
                })
                .collect(),
        }
    }

    #[test]
    fn keeps_only_build_releases_newest_first() {
        let tags: Vec<String> = build_releases(vec![
            release("b10796", &[]),
            release("v0.3.0", &["nightly-tag.txt"]),
            release("b10797", &[]),
            release("b9977", &[]),
        ])
        .into_iter()
        .map(|release| release.tag_name)
        .collect();

        assert_eq!(tags, vec!["b10797", "b10796", "b9977"]);
    }

    #[test]
    fn picks_the_newest_build_that_ships_our_asset() {
        let releases = vec![
            release("b10797", &["llama-b10797-bin-ubuntu-x64.tar.gz"]),
            release(
                "b10796",
                &["llama-b10796-bin-ubuntu-vulkan-x64.tar.gz"],
            ),
        ];

        let (found, asset) = find_release_asset(&releases, &["ubuntu-vulkan-x64"])
            .expect("a build shipping the vulkan asset");
        assert_eq!(found.tag_name, "b10796");
        assert_eq!(asset.name, "llama-b10796-bin-ubuntu-vulkan-x64.tar.gz");

        // Patterns are tried in order, so the preferred build wins within a release,
        // and the CUDA redistributable never stands in for the runtime archive.
        let cuda = vec![release(
            "b10797",
            &[
                "cudart-llama-bin-win-cuda-13.3-x64.zip",
                "llama-b10797-bin-win-cuda-12.4-x64.zip",
                "llama-b10797-bin-win-cuda-13.3-x64.zip",
            ],
        )];
        let (_, preferred) = find_release_asset(&cuda, &["win-cuda-13.3-x64", "win-cuda-12.4-x64"])
            .expect("a cuda asset");
        assert_eq!(preferred.name, "llama-b10797-bin-win-cuda-13.3-x64.zip");

        assert!(find_release_asset(&releases, &["macos-arm64"]).is_none());
    }

    #[test]
    fn reports_an_update_only_when_a_newer_build_exists() {
        let available = update_info_json(Some("b7891"), Some("b7950"), Some(10), false, None);
        assert_eq!(available["updateAvailable"], serde_json::json!(true));
        assert_eq!(available["installedVersion"], serde_json::json!("b7891"));

        let current = update_info_json(Some("b7950"), Some("b7950"), Some(10), false, None);
        assert_eq!(current["updateAvailable"], serde_json::json!(false));

        let custom = update_info_json(Some("b7891"), Some("b7950"), Some(10), true, None);
        assert_eq!(custom["updateAvailable"], serde_json::json!(false));

        let offline = update_info_json(Some("b7891"), None, None, false, Some("no network".into()));
        assert_eq!(offline["updateAvailable"], serde_json::json!(false));
        assert_eq!(offline["message"], serde_json::json!("no network"));
    }

    #[test]
    fn lists_installed_builds_newest_first() {
        let root = std::env::temp_dir().join(format!("navi-builds-{}", pick_free_port().unwrap()));
        let name = if cfg!(windows) { "llama-server.exe" } else { "llama-server" };
        for tag in ["b7891", "b7950", "b800"] {
            let dir = root.join(tag).join("build").join("bin");
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join(name), b"binary").unwrap();
        }
        // A directory with no binary is not a usable build.
        fs::create_dir_all(root.join("b9999")).unwrap();

        let tags: Vec<String> = installed_builds(&root)
            .into_iter()
            .map(|build| build.tag)
            .collect();
        let _ = fs::remove_dir_all(&root);

        assert_eq!(tags, vec!["b7950", "b7891", "b800"]);
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
