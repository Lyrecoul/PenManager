import {
  DashboardOutlined,
  DevicesOutlined,
  ExtensionOutlined,
  FolderOutlined,
  MonitorHeartOutlined,
  SettingsOutlined,
  StorefrontOutlined,
  TerminalOutlined,
  TuneOutlined,
} from "@mui/icons-material";
import { Box, Divider, List, ListItemButton, ListItemIcon, ListItemText, Typography } from "@mui/material";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import ConnectionControl from "./ConnectionControl";

const navItems = [
  { path: "/", label: "概览", icon: <DashboardOutlined />, exact: true },
  { path: "/files", label: "文件", icon: <FolderOutlined /> },
  { path: "/terminal", label: "终端", icon: <TerminalOutlined /> },
  { path: "/plugins", label: "插件", icon: <ExtensionOutlined /> },
  { path: "/market", label: "插件市场", icon: <StorefrontOutlined /> },
  { path: "/performance", label: "性能监视", icon: <MonitorHeartOutlined /> },
  { path: "/penmods-config", label: "PenMods 配置", icon: <TuneOutlined /> },
  { path: "/device", label: "设备", icon: <DevicesOutlined /> },
];

const titles: Record<string, string> = {
  "/": "设备概览",
  "/files": "文件管理",
  "/terminal": "终端",
  "/plugins": "PenMods 插件",
  "/market": "插件市场",
  "/performance": "性能监视",
  "/penmods-config": "PenMods 配置",
  "/device": "设备管理",
  "/settings": "设置",
};

export default function AppShell() {
  const location = useLocation();

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", height: "100vh" }}>
      <Box
        component="aside"
        sx={{
          bgcolor: "#eef3f8",
          borderRight: "1px solid",
          borderColor: "divider",
          display: "flex",
          minHeight: 0,
          flexDirection: "column",
        }}
      >
        <Box sx={{ height: 72, px: 2.5, display: "flex", alignItems: "center", gap: 1.25 }}>
          <Box
            sx={{
              width: 34,
              height: 34,
              bgcolor: "primary.main",
              color: "white",
              borderRadius: 1,
              display: "grid",
              placeItems: "center",
              fontWeight: 700,
              fontSize: 17,
            }}
          >
            P
          </Box>
          <Typography variant="h2" sx={{ fontSize: 18 }}>
            PenManager
          </Typography>
        </Box>

        <List sx={{ px: 1.25, py: 0.5 }}>
          {navItems.map((item) => (
            <ListItemButton
              key={item.path}
              component={NavLink}
              to={item.path}
              selected={item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path)}
              sx={{ mb: 0.5, minHeight: 44, borderRadius: 1, "&.Mui-selected": { bgcolor: "#d3e3fd" } }}
            >
              <ListItemIcon sx={{ minWidth: 38, color: "inherit" }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} primaryTypographyProps={{ fontWeight: 500 }} />
            </ListItemButton>
          ))}
        </List>

        <Box sx={{ flex: 1 }} />
        <Divider />
        <List sx={{ px: 1.25, py: 1 }}>
          <ListItemButton
            component={NavLink}
            to="/settings"
            selected={location.pathname === "/settings"}
            sx={{ minHeight: 44, borderRadius: 1, "&.Mui-selected": { bgcolor: "#d3e3fd" } }}
          >
            <ListItemIcon sx={{ minWidth: 38, color: "inherit" }}>
              <SettingsOutlined />
            </ListItemIcon>
            <ListItemText primary="设置" primaryTypographyProps={{ fontWeight: 500 }} />
          </ListItemButton>
        </List>
      </Box>

      <Box sx={{ minWidth: 0, minHeight: 0, display: "grid", gridTemplateRows: "72px minmax(0, 1fr)" }}>
        <Box
          component="header"
          sx={{
            px: 3,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
          }}
        >
          <Typography component="h1" variant="h1">
            {titles[location.pathname] ?? "PenManager"}
          </Typography>
          <ConnectionControl />
        </Box>
        <Box component="main" sx={{ minWidth: 0, minHeight: 0, overflow: "auto", p: 3 }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
