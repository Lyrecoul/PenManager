import { invoke } from "@tauri-apps/api/core";
import type {
  ArchivePlugin,
  ConnectionProfile,
  DeviceSummary,
  MarketIndex,
  PenModsSource,
  PenModsConfigDocument,
  PerformanceSnapshot,
  PluginInfo,
  RemoteFile,
} from "./types";

const isTauri = () => "__TAURI_INTERNALS__" in window;

async function call<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri()) throw new Error("此操作需要在 PenManager 桌面应用中运行");
  return invoke<T>(command, args);
}

export const backend = {
  connect: (profile: ConnectionProfile) => call<DeviceSummary>("connect_device", { profile }),
  disconnect: () => call<void>("disconnect_device"),
  deviceInfo: () => call<DeviceSummary>("get_device_info"),
  performanceSnapshot: () => call<PerformanceSnapshot>("get_performance_snapshot"),
  killProcess: (pid: number, signal: 9 | 15) => call<void>("kill_process", { pid, signal }),
  readPenmodsConfig: () => call<PenModsConfigDocument>("read_penmods_config"),
  writePenmodsConfig: (path: string, content: Record<string, unknown>) =>
    call<{ backupPath: string }>("write_penmods_config", { path, content }),
  listFiles: (path: string) => call<RemoteFile[]>("list_files", { path }),
  createDirectory: (path: string) => call<void>("create_directory", { path }),
  removePaths: (paths: string[]) => call<void>("remove_paths", { paths }),
  renamePath: (path: string, newName: string) => call<void>("rename_path", { path, newName }),
  uploadFiles: (localPaths: string[], remotePath: string) =>
    call<void>("upload_files", { localPaths, remotePath }),
  downloadFiles: (remotePaths: string[], localPath: string) =>
    call<void>("download_files", { remotePaths, localPath }),
  runCommand: (command: string) => call<{ output: string; status: number }>("run_command", { command }),
  startTerminal: (sessionId: string, columns: number, rows: number) =>
    call<void>("start_terminal", { sessionId, columns, rows }),
  terminalInput: (sessionId: string, data: string) =>
    call<void>("terminal_input", { sessionId, data }),
  resizeTerminal: (sessionId: string, columns: number, rows: number) =>
    call<void>("resize_terminal", { sessionId, columns, rows }),
  closeTerminal: (sessionId: string) => call<void>("close_terminal", { sessionId }),
  listPlugins: () => call<PluginInfo[]>("list_plugins"),
  setPluginEnabled: (id: string, enabled: boolean) =>
    call<void>("set_plugin_enabled", { id, enabled }),
  removePlugin: (id: string) => call<void>("remove_plugin", { id }),
  inspectPluginArchive: (path: string) =>
    call<ArchivePlugin[]>("inspect_plugin_archive", { path }),
  installPluginArchive: (path: string, ids: string[], enable: boolean) =>
    call<void>("install_plugin_archive", { path, ids, enable }),
  loadMarket: (url: string) => call<MarketIndex>("load_market", { url }),
  installMarketPlugin: (url: string, sha256: string, roots: string[] | undefined, enable: boolean) =>
    call<void>("install_market_plugin", { url, sha256, roots, enable }),
  checkPenmodsUpdate: (source: PenModsSource) =>
    call<{ version: string; commit?: string; publishedAt?: string; downloadUrl: string }>("check_penmods_update", { source }),
  installPenmodsUpdate: (source: PenModsSource) =>
    call<void>("install_penmods_update", { source }),
  restartMainApp: () => call<void>("restart_main_app"),
};
