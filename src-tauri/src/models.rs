use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub transport: TransportKind,
    pub serial: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TransportKind {
    Adb,
    Ssh,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSummary {
    pub connected: bool,
    pub transport: Option<TransportKind>,
    pub model: Option<String>,
    pub serial: Option<String>,
    pub firmware: Option<String>,
    pub address: Option<String>,
    pub battery: Option<u8>,
    pub storage_total: Option<u64>,
    pub storage_used: Option<u64>,
    pub storage_available: Option<u64>,
    pub storage_percent: Option<u8>,
    pub penmods_installed: Option<bool>,
    pub penmods_version: Option<String>,
    pub process_running: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFile {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub size: u64,
    pub modified: i64,
    pub mode: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PluginMetadata {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version: String,
    pub author: Option<String>,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub main_qml: Option<String>,
    pub main_so: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: Option<String>,
    pub description: Option<String>,
    pub path: String,
    pub enabled: bool,
    pub loaded: Option<bool>,
    pub native: bool,
    pub health: String,
    pub restart_required: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivePlugin {
    #[serde(flatten)]
    pub plugin: PluginInfo,
    pub archive_root: String,
    pub selected: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub output: String,
    pub status: i32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PenModsSource {
    pub repository: String,
    pub branch: String,
    pub workflow: String,
    pub platform: String,
    pub channel: String,
    pub token: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PenModsUpdate {
    pub version: String,
    pub commit: Option<String>,
    pub published_at: Option<String>,
    pub download_url: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceSnapshot {
    pub timestamp_ms: u64,
    pub cpu_total_ticks: u64,
    pub cpu_idle_ticks: u64,
    pub cpu_count: u32,
    pub load_average: [f32; 3],
    pub uptime_seconds: u64,
    pub memory_total: u64,
    pub memory_available: u64,
    pub swap_total: u64,
    pub swap_used: u64,
    pub temperature_celsius: Option<f32>,
    pub processes: Vec<ProcessInfo>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub parent_pid: u32,
    pub name: String,
    pub command: String,
    pub state: String,
    pub cpu_ticks: u64,
    pub memory_bytes: u64,
    pub threads: u32,
    pub nice: i32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PenModsConfigDocument {
    pub path: String,
    pub content: serde_json::Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigWriteResult {
    pub backup_path: String,
}
