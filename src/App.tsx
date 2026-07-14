import { Navigate, Route, Routes } from "react-router-dom";
import { Suspense, lazy } from "react";
import { Box, CircularProgress } from "@mui/material";
import AppShell from "./components/AppShell";

const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const DevicePage = lazy(() => import("./pages/DevicePage"));
const FilesPage = lazy(() => import("./pages/FilesPage"));
const MarketPage = lazy(() => import("./pages/MarketPage"));
const PerformancePage = lazy(() => import("./pages/PerformancePage"));
const PenModsConfigPage = lazy(() => import("./pages/PenModsConfigPage"));
const PluginsPage = lazy(() => import("./pages/PluginsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const TerminalPage = lazy(() => import("./pages/TerminalPage"));

export default function App() {
  return (
    <Suspense fallback={<Box sx={{ height: "100vh", display: "grid", placeItems: "center" }}><CircularProgress size={28} /></Box>}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="files" element={<FilesPage />} />
          <Route path="terminal" element={<TerminalPage />} />
          <Route path="plugins" element={<PluginsPage />} />
          <Route path="market" element={<MarketPage />} />
          <Route path="performance" element={<PerformancePage />} />
          <Route path="penmods-config" element={<PenModsConfigPage />} />
          <Route path="device" element={<DevicePage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
