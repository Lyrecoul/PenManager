import { CableOutlined, ExpandMore, LanOutlined, LinkOffOutlined } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { backend } from "../backend";
import { useAppState } from "../state";
import type { ConnectionProfile, TransportKind } from "../types";

export default function ConnectionControl() {
  const { profiles, activeProfile, device, setActiveProfile, setDevice } = useAppState();
  const [open, setOpen] = useState(false);
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "");
  const [transport, setTransport] = useState<TransportKind>("adb");
  const [host, setHost] = useState("192.168.1.100");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("root");
  const [password, setPassword] = useState("");
  const [serial, setSerial] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const connect = async () => {
    setBusy(true);
    setError("");
    const selected = profiles.find((item) => item.id === profileId);
    const profile: ConnectionProfile = {
      id: selected?.id ?? crypto.randomUUID(),
      name: selected?.name ?? (transport === "adb" ? "ADB 设备" : host),
      transport,
      serial: serial || undefined,
      host: transport === "ssh" ? host : undefined,
      port: transport === "ssh" ? port : undefined,
      username: transport === "ssh" ? username : undefined,
      password: transport === "ssh" ? password : undefined,
    };
    try {
      const summary = await backend.connect(profile);
      setActiveProfile(profile);
      setDevice(summary);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    try {
      await backend.disconnect();
    } finally {
      setActiveProfile(undefined);
      setDevice({ connected: false });
    }
  };

  if (device.connected) {
    return (
      <Stack direction="row" spacing={1} alignItems="center">
        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "secondary.main" }} />
        <Box sx={{ mr: 1 }}>
          <Typography variant="body2" fontWeight={600}>
            {device.model || activeProfile?.name || "词典笔"}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {device.transport?.toUpperCase()} {device.address || device.serial || "已连接"}
          </Typography>
        </Box>
        <Button size="small" color="inherit" startIcon={<LinkOffOutlined />} onClick={disconnect}>
          断开
        </Button>
      </Stack>
    );
  }

  return (
    <>
      <Button variant="contained" startIcon={<CableOutlined />} endIcon={<ExpandMore />} onClick={() => setOpen(true)}>
        连接设备
      </Button>
      <Dialog open={open} onClose={() => !busy && setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>连接词典笔</DialogTitle>
        <DialogContent>
          <Stack spacing={2.25} sx={{ pt: 1 }}>
            <ToggleButtonGroup
              exclusive
              fullWidth
              value={transport}
              onChange={(_, value: TransportKind | null) => value && setTransport(value)}
              size="small"
            >
              <ToggleButton value="adb">
                <CableOutlined sx={{ mr: 1 }} /> USB / ADB
              </ToggleButton>
              <ToggleButton value="ssh">
                <LanOutlined sx={{ mr: 1 }} /> SSH
              </ToggleButton>
            </ToggleButtonGroup>

            <TextField
              select
              label="连接配置"
              value={profileId}
              onChange={(event) => {
                const id = event.target.value;
                setProfileId(id);
                const profile = profiles.find((item) => item.id === id);
                if (profile) {
                  setTransport(profile.transport);
                  setHost(profile.host ?? host);
                  setPort(profile.port ?? port);
                  setUsername(profile.username ?? username);
                  setSerial(profile.serial ?? "");
                }
              }}
            >
              {profiles.map((profile) => (
                <MenuItem key={profile.id} value={profile.id}>
                  {profile.name}
                </MenuItem>
              ))}
            </TextField>

            {transport === "adb" ? (
              <TextField
                label="ADB 序列号"
                value={serial}
                onChange={(event) => setSerial(event.target.value)}
                helperText="留空时自动选择唯一在线设备"
              />
            ) : (
              <>
                <Stack direction="row" spacing={1.5}>
                  <TextField label="主机" value={host} onChange={(event) => setHost(event.target.value)} fullWidth />
                  <TextField
                    label="端口"
                    type="number"
                    value={port}
                    onChange={(event) => setPort(Number(event.target.value))}
                    sx={{ width: 110 }}
                  />
                </Stack>
                <TextField label="用户名" value={username} onChange={(event) => setUsername(event.target.value)} />
                <TextField
                  label="密码"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </>
            )}
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setOpen(false)} disabled={busy}>
            取消
          </Button>
          <Button variant="contained" onClick={connect} disabled={busy || (transport === "ssh" && !host)}>
            {busy ? <CircularProgress size={20} /> : "连接"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
