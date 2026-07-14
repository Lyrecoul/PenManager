import {
  DeleteSweepOutlined,
  InfoOutlined,
  PowerSettingsNewOutlined,
  RefreshOutlined,
  RestartAltOutlined,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { backend } from "../backend";
import EmptyState from "../components/EmptyState";
import { useAppState } from "../state";

export default function DevicePage() {
  const { device, setDevice } = useAppState();
  const [confirm, setConfirm] = useState<"restart" | "reboot" | null>(null);
  const [message, setMessage] = useState("");
  const details = [
    ["设备型号", device.model || "未知"],
    ["系统版本", device.firmware || "经典系统（Buildroot）"],
    ["序列号", device.serial || "未知"],
    ["连接地址", device.address || "USB 连接"],
    ["用户存储", formatStorage(device.storageUsed, device.storageTotal, device.storageAvailable)],
    ["PenMods", formatPenmods(device.penmodsInstalled, device.penmodsVersion)],
  ];
  const lastRowStart = Math.floor((details.length - 1) / 2) * 2;

  if (!device.connected) {
    return <EmptyState title="需要连接设备" description="连接后可查看硬件信息并执行常用维护操作。" />;
  }

  const refresh = async () => {
    try {
      setDevice(await backend.deviceInfo());
    } catch (error) {
      setMessage(String(error));
    }
  };

  const execute = async (command: string, success: string) => {
    try {
      await backend.runCommand(command);
      setMessage(success);
    } catch (error) {
      setMessage(String(error));
    }
  };

  return (
    <Stack spacing={2.5}>
      <Card>
        <CardContent sx={{ p: 0, "&:last-child": { pb: 0 } }}>
          <Stack direction="row" alignItems="center" sx={{ px: 2.5, py: 2 }}>
            <InfoOutlined color="primary" sx={{ mr: 1.25 }} />
            <Typography variant="h2" sx={{ flex: 1 }}>
              设备信息
            </Typography>
            <Chip label={device.processRunning ? "主程序运行中" : "主程序未运行"} color={device.processRunning ? "success" : "default"} />
            <Button color="inherit" startIcon={<RefreshOutlined />} onClick={refresh} sx={{ ml: 1 }}>
              刷新
            </Button>
          </Stack>
          <Divider />
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)" }}>
            {details.map(([label, value], index) => (
              <Box
                key={label}
                sx={{
                  px: 2.5,
                  py: 1.75,
                  borderBottom: index < lastRowStart ? "1px solid" : undefined,
                  borderRight: index % 2 === 0 ? "1px solid" : undefined,
                  borderColor: "divider",
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  {label}
                </Typography>
                <Typography fontWeight={600}>{value}</Typography>
              </Box>
            ))}
          </Box>
        </CardContent>
      </Card>

      <Box>
        <Typography variant="h2" sx={{ mb: 1.5 }}>
          常用管理
        </Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1.5 }}>
          <Action
            icon={<RestartAltOutlined />}
            title="重启有道主程序"
            description="结束 YoudaoDictPen，系统守护进程会重新启动它。"
            onClick={() => setConfirm("restart")}
          />
          <Action
            icon={<DeleteSweepOutlined />}
            title="清理临时文件"
            description="清理 PenMods 可安全重建的临时数据。"
            onClick={() => execute("rm -rf /tmp/PenMods-*", "临时文件已清理")}
          />
          <Action
            icon={<PowerSettingsNewOutlined />}
            title="重新启动设备"
            description="重新启动整个词典笔系统。"
            danger
            onClick={() => setConfirm("reboot")}
          />
        </Box>
      </Box>

      <Alert severity="info">设备命令会按当前连接方式执行。重启主程序后，插件和 PenMods 更新才会完整生效。</Alert>

      <Dialog open={confirm !== null} onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{confirm === "reboot" ? "重新启动设备？" : "重启有道主程序？"}</DialogTitle>
        <DialogContent>
          {confirm === "reboot" ? "当前传输和终端会话会立即断开。" : "正在进行的查词、播放等操作会被中断。"}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setConfirm(null)}>
            取消
          </Button>
          <Button
            color={confirm === "reboot" ? "error" : "primary"}
            variant="contained"
            onClick={async () => {
              const action = confirm;
              setConfirm(null);
              if (action === "restart") await backend.restartMainApp();
              else await backend.runCommand("reboot");
              setMessage(action === "restart" ? "主程序重启命令已发送" : "设备正在重新启动");
            }}
          >
            确认
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={Boolean(message)} autoHideDuration={4000} onClose={() => setMessage("")} message={message} />
    </Stack>
  );
}

function formatPenmods(installed?: boolean, version?: string) {
  if (!installed) return "未安装";
  return version ? `版本 ${version}` : "已安装（版本未知）";
}

function formatStorage(used?: number, total?: number, available?: number) {
  if (used == null || total == null) return "未知";
  const free = available == null ? "" : `，可用 ${formatBytes(available)}`;
  return `已用 ${formatBytes(used)} / ${formatBytes(total)}${free}`;
}

function formatBytes(bytes: number) {
  const gibibyte = 1024 ** 3;
  const mebibyte = 1024 ** 2;
  if (bytes >= gibibyte) return `${(bytes / gibibyte).toFixed(1)} GiB`;
  return `${(bytes / mebibyte).toFixed(0)} MiB`;
}

function Action({
  icon,
  title,
  description,
  danger,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outlined"
      color={danger ? "error" : "inherit"}
      onClick={onClick}
      sx={{ height: 92, p: 1.75, justifyContent: "flex-start", textAlign: "left", bgcolor: "background.paper" }}
    >
      <Box sx={{ alignSelf: "flex-start", mr: 1.5, color: danger ? "error.main" : "primary.main" }}>{icon}</Box>
      <Box>
        <Typography fontWeight={600} color="text.primary">
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {description}
        </Typography>
      </Box>
    </Button>
  );
}
