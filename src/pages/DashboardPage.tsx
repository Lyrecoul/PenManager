import {
  Battery5BarOutlined,
  CheckCircleOutlined,
  FolderOutlined,
  MemoryOutlined,
  PlayArrowOutlined,
  RefreshOutlined,
  TerminalOutlined,
  UsbOutlined,
} from "@mui/icons-material";
import { Alert, Box, Button, Card, CardContent, Chip, Divider, LinearProgress, Stack, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import EmptyState from "../components/EmptyState";
import { backend } from "../backend";
import { useAppState } from "../state";

const quickActions = [
  { label: "浏览文件", path: "/files", icon: <FolderOutlined /> },
  { label: "打开终端", path: "/terminal", icon: <TerminalOutlined /> },
  { label: "管理插件", path: "/plugins", icon: <MemoryOutlined /> },
  { label: "设备操作", path: "/device", icon: <PlayArrowOutlined /> },
];

export default function DashboardPage() {
  const device = useAppState((state) => state.device);
  const setDevice = useAppState((state) => state.setDevice);
  const navigate = useNavigate();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");

  useEffect(() => {
    if (!device.connected) return;
    const timer = window.setInterval(() => {
      void backend.deviceInfo().then(setDevice).catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [device.connected, setDevice]);

  const refresh = async () => {
    setRefreshing(true);
    setRefreshError("");
    try {
      setDevice(await backend.deviceInfo());
    } catch (error) {
      setRefreshError(String(error));
    } finally {
      setRefreshing(false);
    }
  };

  if (!device.connected) {
    return <EmptyState title="尚未连接词典笔" description="支持通过 USB ADB 或局域网 SSH 连接网易有道词典笔二代。" />;
  }

  return (
    <Stack spacing={3}>
      {refreshError && <Alert severity="error" onClose={() => setRefreshError("")}>{refreshError}</Alert>}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "minmax(320px, 1.3fr) minmax(280px, 1fr)",
          gap: 2,
        }}
      >
        <Card>
          <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
              <Box>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
                  <Typography variant="h2">{device.model || "网易有道词典笔二代"}</Typography>
                  <Chip icon={<CheckCircleOutlined />} label="在线" color="success" size="small" />
                </Stack>
                <Typography color="text.secondary">
                  {device.firmware ? `系统 ${device.firmware}` : "RK3326 Buildroot"}
                </Typography>
              </Box>
              <Button size="small" color="inherit" startIcon={<RefreshOutlined />} onClick={refresh} disabled={refreshing}>
                {refreshing ? "刷新中" : "刷新"}
              </Button>
            </Stack>
            <Divider sx={{ my: 2.25 }} />
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 2 }}>
              <Info label="连接方式" value={device.transport?.toUpperCase() || "-"} icon={<UsbOutlined />} />
              <Info label="设备地址" value={device.address || device.serial || "-"} icon={<MemoryOutlined />} />
              <Info
                label="PenMods"
                value={device.penmodsInstalled ? (device.penmodsVersion ? `版本 ${device.penmodsVersion}` : "已安装") : "未安装"}
                icon={<CheckCircleOutlined />}
              />
            </Box>
          </CardContent>
        </Card>

        <Card>
          <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
              <Typography variant="h2">设备状态</Typography>
              <Typography variant="body2" color="text.secondary">
                主程序{device.processRunning ? "运行中" : "未运行"}
              </Typography>
            </Stack>
            <Stack spacing={2.25}>
              <StatusBar
                label="电池"
                value={device.battery ?? 0}
                text={device.battery == null ? "未知" : `${device.battery}%`}
                icon={<Battery5BarOutlined />}
              />
              <StatusBar
                label="用户存储"
                value={device.storagePercent ?? 0}
                text={formatStorageUsage(device.storageUsed, device.storageTotal, device.storagePercent)}
                icon={<MemoryOutlined />}
              />
            </Stack>
          </CardContent>
        </Card>
      </Box>

      <Box>
        <Typography variant="h2" sx={{ mb: 1.5 }}>
          快捷操作
        </Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(150px, 1fr))", gap: 1.5 }}>
          {quickActions.map((action) => (
            <Button
              key={action.path}
              variant="outlined"
              color="inherit"
              startIcon={action.icon}
              onClick={() => navigate(action.path)}
              sx={{ height: 54, justifyContent: "flex-start", px: 2, bgcolor: "background.paper" }}
            >
              {action.label}
            </Button>
          ))}
        </Box>
      </Box>
    </Stack>
  );
}

function formatStorageUsage(used?: number, total?: number, percent?: number) {
  if (used == null || total == null) return "未知";
  const suffix = percent == null ? "" : ` · ${percent}%`;
  return `${formatBytes(used)} / ${formatBytes(total)}${suffix}`;
}

function formatBytes(bytes: number) {
  const gibibyte = 1024 ** 3;
  const mebibyte = 1024 ** 2;
  if (bytes >= gibibyte) return `${(bytes / gibibyte).toFixed(1)} GiB`;
  return `${(bytes / mebibyte).toFixed(0)} MiB`;
}

function Info({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={1.25} alignItems="center" minWidth={0}>
      <Box sx={{ color: "primary.main", display: "flex" }}>{icon}</Box>
      <Box minWidth={0}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography fontWeight={600} noWrap title={value}>
          {value}
        </Typography>
      </Box>
    </Stack>
  );
}

function StatusBar({
  label,
  value,
  text,
  icon,
}: {
  label: string;
  value: number;
  text: string;
  icon: React.ReactNode;
}) {
  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
        <Box sx={{ display: "flex", color: "text.secondary" }}>{icon}</Box>
        <Typography variant="body2" sx={{ flex: 1 }}>
          {label}
        </Typography>
        <Typography variant="body2" fontWeight={600}>
          {text}
        </Typography>
      </Stack>
      <LinearProgress variant="determinate" value={value} sx={{ height: 6, borderRadius: 3 }} />
    </Box>
  );
}
