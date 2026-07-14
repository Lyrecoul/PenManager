import { create } from "zustand";
import type { ConnectionProfile, DeviceSummary, PenModsSource } from "./types";

interface AppState {
  profiles: ConnectionProfile[];
  activeProfile?: ConnectionProfile;
  device: DeviceSummary;
  penmodsSource: PenModsSource;
  setActiveProfile: (profile?: ConnectionProfile) => void;
  setDevice: (device: DeviceSummary) => void;
  setPenmodsSource: (source: PenModsSource) => void;
}

const defaultProfiles: ConnectionProfile[] = [
  { id: "usb", name: "USB 词典笔", transport: "adb" },
  {
    id: "lan",
    name: "局域网词典笔",
    transport: "ssh",
    host: "192.168.1.100",
    port: 22,
    username: "root",
  },
];

const defaultPenmodsSource: PenModsSource = {
  repository: "Lyrecoul/PenMods",
  branch: "main",
  workflow: "build.yaml",
  platform: "YDP02X",
  channel: "ci",
};

function loadPenmodsSource(): PenModsSource {
  try {
    const stored = localStorage.getItem("penmanager.penmodsSource");
    return stored ? { ...defaultPenmodsSource, ...JSON.parse(stored), token: undefined } : defaultPenmodsSource;
  } catch {
    return defaultPenmodsSource;
  }
}

export const useAppState = create<AppState>((set) => ({
  profiles: defaultProfiles,
  device: { connected: false },
  penmodsSource: loadPenmodsSource(),
  setActiveProfile: (activeProfile) => set({ activeProfile }),
  setDevice: (device) => set({ device }),
  setPenmodsSource: (penmodsSource) => {
    const { token: _token, ...persisted } = penmodsSource;
    localStorage.setItem("penmanager.penmodsSource", JSON.stringify(persisted));
    set({ penmodsSource });
  },
}));
