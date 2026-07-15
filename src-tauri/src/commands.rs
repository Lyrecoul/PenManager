use crate::error::{AppError, AppResult};
use crate::market::{self, MarketIndex};
use crate::models::{
    ArchivePlugin, CommandResult, ConfigWriteResult, ConnectionProfile, DeviceSummary,
    PenModsConfigDocument, PenModsSource, PenModsUpdate, PerformanceSnapshot, PluginInfo,
    ProcessInfo, RemoteFile,
};
use crate::plugins;
use crate::terminal::{TerminalManager, TerminalMessage};
use crate::transport::{DeviceConnection, remote_join, shell_quote};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

#[derive(Default)]
pub struct AppState {
    connection: Mutex<Option<DeviceConnection>>,
    plugin_changes: Mutex<HashSet<String>>,
    terminals: TerminalManager,
}

impl AppState {
    fn connection(&self) -> AppResult<DeviceConnection> {
        self.connection
            .lock()
            .map_err(|_| AppError::Other("连接状态锁已损坏".into()))?
            .clone()
            .ok_or(AppError::NotConnected)
    }
}

#[tauri::command]
pub fn connect_device(
    state: State<'_, AppState>,
    profile: ConnectionProfile,
) -> AppResult<DeviceSummary> {
    let connection = DeviceConnection::connect(profile)?;
    let summary = read_device_info(&connection)?;
    *state
        .connection
        .lock()
        .map_err(|_| AppError::Other("连接状态锁已损坏".into()))? = Some(connection);
    state
        .plugin_changes
        .lock()
        .map_err(|_| AppError::Other("插件状态锁已损坏".into()))?
        .clear();
    Ok(summary)
}

#[tauri::command]
pub fn disconnect_device(state: State<'_, AppState>) -> AppResult<()> {
    state.terminals.close_all()?;
    *state
        .connection
        .lock()
        .map_err(|_| AppError::Other("连接状态锁已损坏".into()))? = None;
    state
        .plugin_changes
        .lock()
        .map_err(|_| AppError::Other("插件状态锁已损坏".into()))?
        .clear();
    Ok(())
}

#[tauri::command]
pub async fn get_device_info(state: State<'_, AppState>) -> AppResult<DeviceSummary> {
    let connection = state.connection()?;
    run_blocking(move || read_device_info(&connection)).await
}

#[tauri::command]
pub async fn get_performance_snapshot(
    state: State<'_, AppState>,
) -> AppResult<PerformanceSnapshot> {
    let connection = state.connection()?;
    run_blocking(move || read_performance_snapshot(&connection)).await
}

#[tauri::command]
pub async fn kill_process(state: State<'_, AppState>, pid: u32, signal: u8) -> AppResult<()> {
    if pid <= 1 || !matches!(signal, 9 | 15) {
        return Err(AppError::Device("拒绝无效或危险的进程操作".into()));
    }
    let connection = state.connection()?;
    run_blocking(move || {
        connection.exec(&format!("kill -{signal} {pid}"))?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn read_penmods_config(state: State<'_, AppState>) -> AppResult<PenModsConfigDocument> {
    let connection = state.connection()?;
    run_blocking(move || read_config_document(&connection)).await
}

#[tauri::command]
pub async fn write_penmods_config(
    state: State<'_, AppState>,
    path: String,
    content: serde_json::Value,
) -> AppResult<ConfigWriteResult> {
    let connection = state.connection()?;
    run_blocking(move || write_config_document(&connection, &path, content)).await
}

#[tauri::command]
pub async fn list_files(state: State<'_, AppState>, path: String) -> AppResult<Vec<RemoteFile>> {
    validate_remote_path(&path)?;
    let connection = state.connection()?;
    run_blocking(move || connection.list_dir(&path)).await
}

#[tauri::command]
pub async fn create_directory(state: State<'_, AppState>, path: String) -> AppResult<()> {
    validate_remote_path(&path)?;
    let connection = state.connection()?;
    run_blocking(move || connection.create_dir(&path)).await
}

#[tauri::command]
pub async fn remove_paths(state: State<'_, AppState>, paths: Vec<String>) -> AppResult<()> {
    for path in &paths {
        validate_remote_path(path)?;
        if path == "/" || path == "/userdata" || path == "/userdisk" {
            return Err(AppError::Device(format!("拒绝删除受保护路径：{path}")));
        }
    }
    let connection = state.connection()?;
    run_blocking(move || connection.remove_paths(&paths)).await
}

#[tauri::command]
pub async fn rename_path(
    state: State<'_, AppState>,
    path: String,
    new_name: String,
) -> AppResult<()> {
    validate_remote_path(&path)?;
    validate_file_name(&new_name)?;
    let parent = path
        .rsplit_once('/')
        .map(|(parent, _)| if parent.is_empty() { "/" } else { parent })
        .unwrap_or("/");
    let destination = remote_join(parent, &new_name);
    let connection = state.connection()?;
    run_blocking(move || connection.rename(&path, &destination)).await
}

#[tauri::command]
pub async fn upload_files(
    state: State<'_, AppState>,
    local_paths: Vec<String>,
    remote_path: String,
) -> AppResult<()> {
    validate_remote_path(&remote_path)?;
    let paths = local_paths
        .into_iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    for path in &paths {
        if !path.exists() {
            return Err(AppError::Other(format!(
                "本地文件不存在：{}",
                path.display()
            )));
        }
    }
    let connection = state.connection()?;
    run_blocking(move || connection.upload_paths(&paths, &remote_path)).await
}

#[tauri::command]
pub async fn download_files(
    state: State<'_, AppState>,
    remote_paths: Vec<String>,
    local_path: String,
) -> AppResult<()> {
    for path in &remote_paths {
        validate_remote_path(path)?;
    }
    let connection = state.connection()?;
    run_blocking(move || connection.download_paths(&remote_paths, Path::new(&local_path))).await
}

#[tauri::command]
pub fn run_command(state: State<'_, AppState>, command: String) -> AppResult<CommandResult> {
    if command.contains('\0') {
        return Err(AppError::Device("命令包含 NUL 字符".into()));
    }
    state.connection()?.exec(&command)
}

#[tauri::command]
pub fn start_terminal(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    columns: u32,
    rows: u32,
) -> AppResult<()> {
    state.terminals.start(
        app,
        session_id,
        state.connection()?,
        columns.clamp(20, 500),
        rows.clamp(5, 200),
    )
}

#[tauri::command]
pub fn terminal_input(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> AppResult<()> {
    state
        .terminals
        .send(&session_id, TerminalMessage::Input(data))
}

#[tauri::command]
pub fn resize_terminal(
    state: State<'_, AppState>,
    session_id: String,
    columns: u32,
    rows: u32,
) -> AppResult<()> {
    state.terminals.send(
        &session_id,
        TerminalMessage::Resize(columns.clamp(20, 500), rows.clamp(5, 200)),
    )
}

#[tauri::command]
pub fn close_terminal(state: State<'_, AppState>, session_id: String) -> AppResult<()> {
    state.terminals.close(&session_id)
}

#[tauri::command]
pub async fn list_plugins(state: State<'_, AppState>) -> AppResult<Vec<PluginInfo>> {
    let changed = state
        .plugin_changes
        .lock()
        .map_err(|_| AppError::Other("插件状态锁已损坏".into()))?
        .clone();
    let connection = state.connection()?;
    run_blocking(move || plugins::list_plugins(&connection, &changed)).await
}

#[tauri::command]
pub async fn set_plugin_enabled(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> AppResult<()> {
    let connection = state.connection()?;
    let task_id = id.clone();
    run_blocking(move || plugins::set_enabled(&connection, &task_id, enabled)).await?;
    state
        .plugin_changes
        .lock()
        .map_err(|_| AppError::Other("插件状态锁已损坏".into()))?
        .insert(id);
    Ok(())
}

#[tauri::command]
pub async fn remove_plugin(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let connection = state.connection()?;
    let task_id = id.clone();
    run_blocking(move || plugins::remove_plugin(&connection, &task_id)).await?;
    state
        .plugin_changes
        .lock()
        .map_err(|_| AppError::Other("插件状态锁已损坏".into()))?
        .insert(id);
    Ok(())
}

#[tauri::command]
pub async fn inspect_plugin_archive(path: String) -> AppResult<Vec<ArchivePlugin>> {
    run_blocking(move || plugins::inspect_archive(Path::new(&path))).await
}

#[tauri::command]
pub async fn install_plugin_archive(
    state: State<'_, AppState>,
    path: String,
    ids: Vec<String>,
    enable: bool,
) -> AppResult<()> {
    let selected = ids.into_iter().collect::<HashSet<_>>();
    let connection = state.connection()?;
    let installed = run_blocking(move || {
        plugins::install_archive(&connection, Path::new(&path), Some(&selected), None, enable)
    })
    .await?;
    state
        .plugin_changes
        .lock()
        .map_err(|_| AppError::Other("插件状态锁已损坏".into()))?
        .extend(installed);
    Ok(())
}

#[tauri::command]
pub async fn load_market(url: String) -> AppResult<MarketIndex> {
    market::load_market(&url).await
}

#[tauri::command]
pub async fn install_market_plugin(
    state: State<'_, AppState>,
    url: String,
    sha256: String,
    roots: Option<Vec<String>>,
    enable: bool,
) -> AppResult<()> {
    let connection = state.connection()?;
    let installed =
        market::install_market_plugin(&connection, &url, &sha256, roots.as_deref(), enable).await?;
    state
        .plugin_changes
        .lock()
        .map_err(|_| AppError::Other("插件状态锁已损坏".into()))?
        .extend(installed);
    Ok(())
}

#[tauri::command]
pub async fn check_penmods_update(source: PenModsSource) -> AppResult<PenModsUpdate> {
    market::check_penmods_update(&source).await
}

#[tauri::command]
pub async fn install_penmods_update(
    state: State<'_, AppState>,
    source: PenModsSource,
) -> AppResult<()> {
    let connection = state.connection()?;
    market::install_penmods_update(&connection, &source).await
}

#[tauri::command]
pub fn restart_main_app(state: State<'_, AppState>) -> AppResult<()> {
    state
        .connection()?
        .exec("killall YoudaoDictPen 2>/dev/null || true")?;
    state
        .plugin_changes
        .lock()
        .map_err(|_| AppError::Other("插件状态锁已损坏".into()))?
        .clear();
    Ok(())
}

fn read_performance_snapshot(connection: &DeviceConnection) -> AppResult<PerformanceSnapshot> {
    let output = connection.exec(
        "printf '@@CPU@@\\n'; head -1 /proc/stat; \
         printf '@@CPUCOUNT@@\\n'; grep -c '^cpu[0-9]' /proc/stat; \
         printf '@@LOAD@@\\n'; cat /proc/loadavg; \
         printf '@@UPTIME@@\\n'; cat /proc/uptime; \
         printf '@@MEMORY@@\\n'; cat /proc/meminfo; \
         printf '@@TEMP@@\\n'; for f in /sys/class/thermal/thermal_zone*/temp; do cat \"$f\" 2>/dev/null; done; \
         printf '@@PROCESSES@@\\n'; \
         for p in /proc/[0-9]*; do \
           [ -r \"$p/stat\" ] || continue; \
           IFS= read -r stat <\"$p/stat\" 2>/dev/null || continue; \
           rss=0; threads=1; \
           while IFS=: read -r key value; do \
             case \"$key\" in \
               VmRSS) set -- $value; rss=${1:-0} ;; \
               Threads) set -- $value; threads=${1:-1} ;; \
             esac; \
           done <\"$p/status\" 2>/dev/null; \
           cmd=$(tr '\\000' ' ' <\"$p/cmdline\" 2>/dev/null); \
           printf '%s\\034%s\\034%s\\034%s\\036' \"$stat\" \"$rss\" \"$threads\" \"$cmd\"; \
         done",
    )?;
    parse_performance_snapshot(&output.output)
}

fn parse_performance_snapshot(raw: &str) -> AppResult<PerformanceSnapshot> {
    let (header, process_data) = raw
        .split_once("@@PROCESSES@@")
        .ok_or_else(|| AppError::Device("设备性能数据格式无效".into()))?;
    let process_data = process_data.trim_start_matches(['\r', '\n']);
    let mut sections: HashMap<&str, String> = HashMap::new();
    let mut current = "";
    for line in header.lines() {
        if line.starts_with("@@") && line.ends_with("@@") {
            current = line.trim_matches('@');
        } else if !current.is_empty() {
            sections
                .entry(current)
                .or_default()
                .push_str(&format!("{line}\n"));
        }
    }

    let cpu_values = sections
        .get("CPU")
        .and_then(|value| value.lines().next())
        .ok_or_else(|| AppError::Device("缺少 CPU 统计".into()))?
        .split_whitespace()
        .skip(1)
        .filter_map(|value| value.parse::<u64>().ok())
        .collect::<Vec<_>>();
    if cpu_values.len() < 4 {
        return Err(AppError::Device("CPU 统计字段不足".into()));
    }
    let cpu_total_ticks = cpu_values.iter().sum();
    let cpu_idle_ticks = cpu_values[3] + cpu_values.get(4).copied().unwrap_or(0);
    let cpu_count = section_first(&sections, "CPUCOUNT")
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(1)
        .max(1);
    let load_values = section_first(&sections, "LOAD")
        .unwrap_or_default()
        .split_whitespace()
        .take(3)
        .filter_map(|value| value.parse::<f32>().ok())
        .collect::<Vec<_>>();
    let load_average = [
        load_values.first().copied().unwrap_or(0.0),
        load_values.get(1).copied().unwrap_or(0.0),
        load_values.get(2).copied().unwrap_or(0.0),
    ];
    let uptime_seconds = section_first(&sections, "UPTIME")
        .and_then(|value| value.split_whitespace().next())
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(0.0) as u64;
    let memory = parse_meminfo(
        sections
            .get("MEMORY")
            .map(String::as_str)
            .unwrap_or_default(),
    );
    let memory_total = memory.get("MemTotal").copied().unwrap_or(0) * 1024;
    let memory_available = memory
        .get("MemAvailable")
        .or_else(|| memory.get("MemFree"))
        .copied()
        .unwrap_or(0)
        * 1024;
    let swap_total = memory.get("SwapTotal").copied().unwrap_or(0) * 1024;
    let swap_free = memory.get("SwapFree").copied().unwrap_or(0) * 1024;
    let temperature_celsius = sections.get("TEMP").and_then(|values| {
        values
            .lines()
            .filter_map(|value| value.trim().parse::<f32>().ok())
            .map(|value| {
                if value > 1000.0 {
                    value / 1000.0
                } else {
                    value
                }
            })
            .reduce(f32::max)
    });
    let processes = process_data
        // Avoid NUL records: Windows ADB output handling may truncate or discard them.
        .split('\u{1e}')
        .filter(|record| !record.is_empty())
        .filter_map(parse_process_record)
        .collect();

    Ok(PerformanceSnapshot {
        timestamp_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        cpu_total_ticks,
        cpu_idle_ticks,
        cpu_count,
        load_average,
        uptime_seconds,
        memory_total,
        memory_available,
        swap_total,
        swap_used: swap_total.saturating_sub(swap_free),
        temperature_celsius,
        processes,
    })
}

fn section_first<'a>(sections: &'a HashMap<&str, String>, name: &str) -> Option<&'a str> {
    sections.get(name)?.lines().next().map(str::trim)
}

fn parse_meminfo(raw: &str) -> HashMap<&str, u64> {
    raw.lines()
        .filter_map(|line| {
            let (key, value) = line.split_once(':')?;
            let number = value.split_whitespace().next()?.parse().ok()?;
            Some((key, number))
        })
        .collect()
}

fn parse_process_record(record: &str) -> Option<ProcessInfo> {
    let fields = record.splitn(4, '\u{1c}').collect::<Vec<_>>();
    if fields.len() != 4 {
        return None;
    }
    let stat = fields[0];
    let open = stat.find('(')?;
    let close = stat.rfind(") ")?;
    let pid = stat[..open].trim().parse().ok()?;
    let name = stat[open + 1..close].to_string();
    let values = stat[close + 2..].split_whitespace().collect::<Vec<_>>();
    if values.len() < 22 {
        return None;
    }
    let cpu_ticks = values[11]
        .parse::<u64>()
        .ok()?
        .saturating_add(values[12].parse().ok()?);
    let command = if fields[3].trim().is_empty() {
        name.clone()
    } else {
        fields[3].trim().to_string()
    };
    Some(ProcessInfo {
        pid,
        parent_pid: values[1].parse().unwrap_or(0),
        name,
        command,
        state: values[0].to_string(),
        cpu_ticks,
        memory_bytes: fields[1].parse::<u64>().unwrap_or(0) * 1024,
        threads: fields[2].parse().unwrap_or(1),
        nice: values[16].parse().unwrap_or(0),
    })
}

const PENMODS_CONFIG_PATHS: [&str; 3] = [
    "/userdata/PenModsconfig.json",
    "/userdata/PenMods/config.json",
    "/userdisk/PenMods/config.json",
];

fn read_config_document(connection: &DeviceConnection) -> AppResult<PenModsConfigDocument> {
    for path in PENMODS_CONFIG_PATHS {
        let Ok(raw) = connection.read_file(path) else {
            continue;
        };
        let content = serde_json::from_slice::<serde_json::Value>(&raw)
            .map_err(|error| AppError::Device(format!("PenMods 配置 JSON 无效：{error}")))?;
        return Ok(PenModsConfigDocument {
            path: path.to_string(),
            content,
        });
    }
    Err(AppError::Device("没有找到 PenMods 配置文件".into()))
}

fn write_config_document(
    connection: &DeviceConnection,
    path: &str,
    content: serde_json::Value,
) -> AppResult<ConfigWriteResult> {
    if !PENMODS_CONFIG_PATHS.contains(&path) {
        return Err(AppError::Device("拒绝写入未知配置路径".into()));
    }
    let object = content
        .as_object()
        .ok_or_else(|| AppError::Device("PenMods 配置根节点必须是对象".into()))?;
    if !object
        .get("version")
        .is_some_and(serde_json::Value::is_number)
    {
        return Err(AppError::Device("PenMods 配置缺少数字 version 字段".into()));
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let temporary = format!("{path}.penmanager-new");
    let backup_path = format!("{path}.backup-{timestamp}");
    let bytes = serde_json::to_vec_pretty(&content)?;
    connection.write_file(&temporary, &bytes)?;
    let command = format!(
        "if [ -f {path} ]; then cp {path} {backup}; fi; chmod 600 {temporary}; mv {temporary} {path}; sync",
        path = shell_quote(path),
        backup = shell_quote(&backup_path),
        temporary = shell_quote(&temporary),
    );
    if let Err(error) = connection.exec(&command) {
        let _ = connection.exec(&format!("rm -f {}", shell_quote(&temporary)));
        return Err(error);
    }
    Ok(ConfigWriteResult { backup_path })
}

fn read_device_info(connection: &DeviceConnection) -> AppResult<DeviceSummary> {
    let output = connection.exec(
        "model=$(tr -d '\\000' </proc/device-tree/model 2>/dev/null || true); \
         firmware=$(sed -n 's/^Version:[[:space:]]*//p' /userdata/cfg/OtherVersion 2>/dev/null | head -1); \
         for key in FIRMWARE_VERSION SYSTEM_VERSION SW_VERSION VERSION_ID VERSION; do \
           [ -n \"$firmware\" ] && break; \
           for f in /userdata/version /userdisk/version /oem/version /etc/firmware_version /etc/sw-version /etc/os-release /etc/version; do \
             [ -f \"$f\" ] || continue; \
             firmware=$(sed -n \"s/^$key=[\\\"']*\\([^\\\"']*\\)[\\\"']*$/\\1/p\" \"$f\" 2>/dev/null | head -1); \
             [ -n \"$firmware\" ] && break; \
           done; \
         done; \
         battery=$(cat /sys/class/power_supply/battery/capacity 2>/dev/null || true); \
         set -- $(df -kP /userdisk 2>/dev/null | tail -1); \
         storage_total_kib=$2; storage_used_kib=$3; storage_available_kib=$4; storage_percent=$5; \
         running=0; pidof YoudaoDictPen >/dev/null 2>&1 && running=1; \
         penmods_installed=0; penmods_version=''; \
         if [ -f /userdata/PenMods/libPenMods.so ]; then \
           penmods_installed=1; \
           penmods_version=$(grep -aoE '\\[[A-Za-z0-9_-]+\\] [0-9]+\\.[0-9]+\\.[0-9]+\\+' /userdata/PenMods/libPenMods.so 2>/dev/null | head -1 | sed 's/^\\[[^]]*\\] //; s/+$//'); \
         fi; \
         printf 'model=%s\\nfirmware=%s\\nbattery=%s\\nstorage_total_kib=%s\\nstorage_used_kib=%s\\nstorage_available_kib=%s\\nstorage_percent=%s\\nrunning=%s\\npenmods_installed=%s\\npenmods_version=%s\\n' \"$model\" \"$firmware\" \"$battery\" \"$storage_total_kib\" \"$storage_used_kib\" \"$storage_available_kib\" \"$storage_percent\" \"$running\" \"$penmods_installed\" \"$penmods_version\"",
    )?;
    let values = output
        .output
        .lines()
        .filter_map(|line| line.split_once('='))
        .map(|(key, value)| (key, value.trim().trim_matches('"')))
        .collect::<std::collections::HashMap<_, _>>();
    Ok(DeviceSummary {
        connected: true,
        transport: Some(connection.kind()),
        model: Some(normalize_device_model(
            values.get("model").copied().unwrap_or_default(),
        )),
        serial: connection.profile.serial.clone(),
        firmware: normalize_firmware(values.get("firmware").copied()),
        address: connection.profile.host.clone(),
        battery: values
            .get("battery")
            .and_then(|value| value.parse::<u8>().ok()),
        storage_total: values
            .get("storage_total_kib")
            .and_then(|value| kib_to_bytes(value)),
        storage_used: values
            .get("storage_used_kib")
            .and_then(|value| kib_to_bytes(value)),
        storage_available: values
            .get("storage_available_kib")
            .and_then(|value| kib_to_bytes(value)),
        storage_percent: values
            .get("storage_percent")
            .and_then(|value| value.trim_end_matches('%').parse::<u8>().ok())
            .map(|value| value.min(100)),
        penmods_installed: Some(
            values
                .get("penmods_installed")
                .is_some_and(|value| *value == "1"),
        ),
        penmods_version: non_empty(values.get("penmods_version").copied()),
        process_running: Some(values.get("running").is_some_and(|value| *value == "1")),
    })
}

fn normalize_device_model(raw: &str) -> String {
    let normalized = raw.trim().to_ascii_lowercase();
    if normalized.contains("rk3326")
        && (normalized.contains("exam") || normalized.contains("husb311"))
    {
        "网易有道词典笔 2 满分版".into()
    } else if normalized.contains("rk3326")
        && (normalized.contains("classic") || normalized.contains(" cla"))
    {
        "网易有道词典笔 2 经典版".into()
    } else if raw.trim().is_empty() {
        "网易有道词典笔 2".into()
    } else {
        raw.trim().to_string()
    }
}

fn normalize_firmware(raw: Option<&str>) -> Option<String> {
    let value = raw?.trim().trim_matches('"');
    if value.is_empty() || value.starts_with("RK_MODEL=") || value.contains("RKXXXX_RETROGAME") {
        None
    } else {
        Some(value.to_string())
    }
}

fn non_empty(value: Option<&str>) -> Option<String> {
    value.filter(|value| !value.is_empty()).map(str::to_string)
}

fn kib_to_bytes(value: &str) -> Option<u64> {
    value.trim().parse::<u64>().ok()?.checked_mul(1024)
}

fn validate_remote_path(path: &str) -> AppResult<()> {
    if !path.starts_with('/') || path.contains('\0') || path.split('/').any(|part| part == "..") {
        return Err(AppError::Device(format!("远程路径无效：{path}")));
    }
    Ok(())
}

fn validate_file_name(name: &str) -> AppResult<()> {
    if name.is_empty() || name == "." || name == ".." || name.contains('/') || name.contains('\0') {
        return Err(AppError::Device("文件名无效".into()));
    }
    Ok(())
}

async fn run_blocking<T, F>(task: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| AppError::Other(format!("后台任务异常终止：{error}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protects_remote_paths() {
        assert!(validate_remote_path("/userdisk/Music").is_ok());
        assert!(validate_remote_path("relative").is_err());
        assert!(validate_remote_path("/userdisk/../userdata").is_err());
    }

    #[test]
    fn validates_file_names() {
        assert!(validate_file_name("new name.txt").is_ok());
        assert!(validate_file_name("../bad").is_err());
    }

    #[test]
    fn translates_known_dictionary_pen_models() {
        assert_eq!(
            normalize_device_model("Rockchip rk3326 for exam husb311 version"),
            "网易有道词典笔 2 满分版"
        );
    }

    #[test]
    fn rejects_board_configuration_as_firmware_version() {
        assert_eq!(normalize_firmware(Some("RK_MODEL=RKXXXX_RETROGAME")), None);
        assert_eq!(normalize_firmware(Some("2.0.8")), Some("2.0.8".into()));
    }

    #[test]
    fn converts_df_kibibytes_to_bytes() {
        assert_eq!(kib_to_bytes("6905244"), Some(7_070_969_856));
        assert_eq!(kib_to_bytes("invalid"), None);
    }

    #[test]
    fn parses_linux_process_stat_record() {
        let record = "8262 (YoudaoDictPen) S 8239 144 144 0 -1 4194560 82151 150537 132 37 3048 1094 340 772 20 0 44 0 180534 2335383552 46675\u{1c}186700\u{1c}44\u{1c}./YoudaoDictPen -platform wayland ";
        let process = parse_process_record(record).unwrap();
        assert_eq!(process.pid, 8262);
        assert_eq!(process.parent_pid, 8239);
        assert_eq!(process.name, "YoudaoDictPen");
        assert_eq!(process.cpu_ticks, 4142);
        assert_eq!(process.memory_bytes, 191_180_800);
        assert_eq!(process.threads, 44);
    }

    #[test]
    fn parses_performance_snapshot_sections() {
        let raw = "@@CPU@@\ncpu 100 0 50 850 10 0 0 0 0 0\n@@CPUCOUNT@@\n4\n@@LOAD@@\n0.10 0.20 0.30 1/100 123\n@@UPTIME@@\n3600.00 1000.00\n@@MEMORY@@\nMemTotal: 460352 kB\nMemAvailable: 230176 kB\nSwapTotal: 1024 kB\nSwapFree: 512 kB\n@@TEMP@@\n44545\n@@PROCESSES@@\n8262 (YoudaoDictPen) S 1 1 1 0 -1 0 0 0 0 0 100 50 0 0 20 0 4 0 1 0 0\u{1c}1000\u{1c}4\u{1c}YoudaoDictPen\u{1e}";
        let snapshot = parse_performance_snapshot(raw).unwrap();
        assert_eq!(snapshot.cpu_total_ticks, 1010);
        assert_eq!(snapshot.cpu_idle_ticks, 860);
        assert_eq!(snapshot.cpu_count, 4);
        assert_eq!(snapshot.memory_total, 471_400_448);
        assert_eq!(snapshot.swap_used, 524_288);
        assert_eq!(snapshot.temperature_celsius, Some(44.545));
        assert_eq!(snapshot.processes.len(), 1);
    }

    #[test]
    fn parses_adb_crlf_performance_sections() {
        let raw = "@@CPU@@\r\ncpu 100 0 50 850 10 0 0 0 0 0\r\n@@CPUCOUNT@@\r\n4\r\n@@LOAD@@\r\n0.10 0.20 0.30 1/100 123\r\n@@UPTIME@@\r\n3600.00 1000.00\r\n@@MEMORY@@\r\nMemTotal: 460352 kB\r\nMemAvailable: 230176 kB\r\nSwapTotal: 1024 kB\r\nSwapFree: 512 kB\r\n@@TEMP@@\r\n44545\r\n@@PROCESSES@@\r\n8262 (YoudaoDictPen) S 1 1 1 0 -1 0 0 0 0 0 100 50 0 0 20 0 4 0 1 0 0\u{1c}1000\u{1c}4\u{1c}YoudaoDictPen\u{1e}";
        let snapshot = parse_performance_snapshot(raw).unwrap();
        assert_eq!(snapshot.cpu_count, 4);
        assert_eq!(snapshot.temperature_celsius, Some(44.545));
        assert_eq!(snapshot.processes.len(), 1);
    }
}
