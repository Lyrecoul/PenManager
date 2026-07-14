export type TransportKind = "adb" | "ssh";

export interface ConnectionProfile {
  id: string;
  name: string;
  transport: TransportKind;
  serial?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
}

export interface DeviceSummary {
  connected: boolean;
  transport?: TransportKind;
  model?: string;
  serial?: string;
  firmware?: string;
  address?: string;
  battery?: number;
  storageTotal?: number;
  storageUsed?: number;
  storageAvailable?: number;
  storagePercent?: number;
  penmodsInstalled?: boolean;
  penmodsVersion?: string;
  processRunning?: boolean;
}

export interface RemoteFile {
  name: string;
  path: string;
  kind: "file" | "directory" | "link";
  size: number;
  modified: number;
  mode: string;
}

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  path: string;
  enabled: boolean;
  loaded?: boolean;
  native: boolean;
  health: "ok" | "loading-marker" | "invalid" | "missing-entry";
  restartRequired?: boolean;
}

export interface ArchivePlugin extends PluginInfo {
  archiveRoot: string;
  selected: boolean;
}

export interface MarketVersion {
  version: string;
  url: string;
  sha256: string;
  devices?: string[];
  minPenmods?: string;
  native?: boolean;
  roots?: string[];
}

export interface MarketPlugin {
  id: string;
  name: string;
  summary: string;
  author?: string;
  repository?: string;
  icon?: string;
  versions: MarketVersion[];
}

export interface MarketIndex {
  schemaVersion: number;
  name?: string;
  plugins: MarketPlugin[];
}

export interface PenModsSource {
  repository: string;
  branch: string;
  workflow: string;
  platform: string;
  channel: "release" | "ci";
  token?: string;
}

export interface PerformanceSnapshot {
  timestampMs: number;
  cpuTotalTicks: number;
  cpuIdleTicks: number;
  cpuCount: number;
  loadAverage: [number, number, number];
  uptimeSeconds: number;
  memoryTotal: number;
  memoryAvailable: number;
  swapTotal: number;
  swapUsed: number;
  temperatureCelsius?: number;
  processes: ProcessInfo[];
}

export interface ProcessInfo {
  pid: number;
  parentPid: number;
  name: string;
  command: string;
  state: string;
  cpuTicks: number;
  memoryBytes: number;
  threads: number;
  nice: number;
}

export interface PenModsConfigDocument {
  path: string;
  content: Record<string, unknown>;
}
