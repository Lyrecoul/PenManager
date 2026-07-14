import {
  DeleteOutline,
  MemoryOutlined,
  PauseOutlined,
  PlayArrowOutlined,
  RefreshOutlined,
  SearchOutlined,
  SpeedOutlined,
  ThermostatOutlined,
  TimerOutlined,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import { backend } from "../backend";
import EmptyState from "../components/EmptyState";
import { useAppState } from "../state";
import type { PerformanceSnapshot, ProcessInfo } from "../types";

interface ProcessView extends ProcessInfo {
  cpuPercent: number;
}

type ProcessSort = "cpu" | "memory";

export default function PerformancePage() {
  const connected = useAppState((state) => state.device.connected);
  const [snapshot, setSnapshot] = useState<PerformanceSnapshot | null>(null);
  const [processes, setProcesses] = useState<ProcessView[]>([]);
  const [cpuPercent, setCpuPercent] = useState(0);
  const [paused, setPaused] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ProcessSort>("cpu");
  const [error, setError] = useState("");
  const [killTarget, setKillTarget] = useState<ProcessView | null>(null);
  const previous = useRef<PerformanceSnapshot | null>(null);

  useEffect(() => {
    if (!connected || paused) return;
    let stopped = false;
    let timer = 0;
    const sample = async () => {
      const startedAt = Date.now();
      try {
        const next = await backend.performanceSnapshot();
        if (stopped) return;
        const prior = previous.current;
        const totalDelta = prior ? Math.max(0, next.cpuTotalTicks - prior.cpuTotalTicks) : 0;
        const idleDelta = prior ? Math.max(0, next.cpuIdleTicks - prior.cpuIdleTicks) : 0;
        setCpuPercent(totalDelta ? clampPercent(((totalDelta - idleDelta) / totalDelta) * 100) : 0);
        const oldTicks = new Map(prior?.processes.map((process) => [process.pid, process.cpuTicks]) ?? []);
        setProcesses(
          next.processes.map((process) => ({
            ...process,
            cpuPercent: totalDelta
              ? clampPercent(((process.cpuTicks - (oldTicks.get(process.pid) ?? process.cpuTicks)) / totalDelta) * 100 * next.cpuCount)
              : 0,
          })),
        );
        previous.current = next;
        setSnapshot(next);
        setError("");
      } catch (cause) {
        if (!stopped) setError(String(cause));
      } finally {
        if (!stopped) timer = window.setTimeout(sample, Math.max(100, 2_000 - (Date.now() - startedAt)));
      }
    };
    void sample();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [connected, paused]);

  const visibleProcesses = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return processes
      .filter((process) => !needle || `${process.pid} ${process.name} ${process.command}`.toLocaleLowerCase().includes(needle))
      .sort((a, b) => sort === "cpu"
        ? b.cpuPercent - a.cpuPercent || b.memoryBytes - a.memoryBytes
        : b.memoryBytes - a.memoryBytes || b.cpuPercent - a.cpuPercent);
  }, [processes, query, sort]);

  if (!connected) {
    return <EmptyState icon={<SpeedOutlined />} title="连接后监视性能" description="查看设备 CPU、内存、温度、负载和进程状态。" />;
  }

  const memoryUsed = snapshot ? Math.max(0, snapshot.memoryTotal - snapshot.memoryAvailable) : 0;
  const memoryPercent = snapshot?.memoryTotal ? clampPercent((memoryUsed / snapshot.memoryTotal) * 100) : 0;
  const swapPercent = snapshot?.swapTotal ? clampPercent((snapshot.swapUsed / snapshot.swapTotal) * 100) : 0;

  return (
    <Stack spacing={2} sx={{ height: "100%", minHeight: 600 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Chip label={paused ? "已暂停" : "每 2 秒更新"} color={paused ? "default" : "success"} variant="outlined" />
        <Typography variant="body2" color="text.secondary">
          {snapshot ? `运行时间 ${formatUptime(snapshot.uptimeSeconds)}` : "正在读取设备状态"}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title={paused ? "继续采样" : "暂停采样"}>
          <IconButton onClick={() => setPaused((value) => !value)}>{paused ? <PlayArrowOutlined /> : <PauseOutlined />}</IconButton>
        </Tooltip>
        <Tooltip title="立即刷新">
          <IconButton onClick={() => { previous.current = null; setPaused(true); requestAnimationFrame(() => setPaused(false)); }}>
            <RefreshOutlined />
          </IconButton>
        </Tooltip>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(180px, 1fr))", gap: 1.5 }}>
        <Metric label={`CPU · ${snapshot?.cpuCount ?? 0} 核`} value={`${cpuPercent.toFixed(1)}%`} percent={cpuPercent} icon={<SpeedOutlined />} color="primary" />
        <Metric
          label="内存"
          value={snapshot ? `${formatBytes(memoryUsed)} / ${formatBytes(snapshot.memoryTotal)}` : "-"}
          percent={memoryPercent}
          icon={<MemoryOutlined />}
          color="success"
        />
        <Metric
          label="负载 1 / 5 / 15 分钟"
          value={snapshot ? snapshot.loadAverage.map((value) => value.toFixed(2)).join("  ") : "-"}
          icon={<TimerOutlined />}
        />
        <Metric
          label="最高温度"
          value={snapshot?.temperatureCelsius == null ? "未知" : `${snapshot.temperatureCelsius.toFixed(1)} °C`}
          icon={<ThermostatOutlined />}
          color={(snapshot?.temperatureCelsius ?? 0) >= 70 ? "error" : "warning"}
        />
      </Box>

      {snapshot && snapshot.swapTotal > 0 && (
        <Metric label="交换空间" value={`${formatBytes(snapshot.swapUsed)} / ${formatBytes(snapshot.swapTotal)}`} percent={swapPercent} icon={<MemoryOutlined />} color="warning" />
      )}

      <Paper variant="outlined" sx={{ flex: 1, minHeight: 360, display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", overflow: "hidden" }}>
        <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1.25, borderBottom: "1px solid", borderColor: "divider" }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h2">进程</Typography>
            <Typography variant="caption" color="text.secondary">{visibleProcesses.length} 个可见进程</Typography>
          </Box>
          <TextField
            size="small"
            placeholder="搜索 PID 或命令"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            sx={{ width: 260 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchOutlined fontSize="small" /></InputAdornment> }}
          />
        </Stack>
        <Box sx={{ overflow: "auto" }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell width={78}>PID</TableCell>
                <TableCell>命令</TableCell>
                <TableCell width={90}>状态</TableCell>
                <TableCell width={90} align="right">
                  <TableSortLabel active={sort === "cpu"} direction="desc" onClick={() => setSort("cpu")}>
                    CPU
                  </TableSortLabel>
                </TableCell>
                <TableCell width={110} align="right">
                  <TableSortLabel active={sort === "memory"} direction="desc" onClick={() => setSort("memory")}>
                    内存
                  </TableSortLabel>
                </TableCell>
                <TableCell width={72} align="right">线程</TableCell>
                <TableCell width={60} align="right">NI</TableCell>
                <TableCell width={56} />
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleProcesses.map((process) => (
                <TableRow key={process.pid} hover>
                  <TableCell sx={{ fontFamily: "monospace" }}>{process.pid}</TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600} noWrap>{process.name}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", maxWidth: 520 }} title={process.command}>{process.command}</Typography>
                  </TableCell>
                  <TableCell>{stateLabel(process.state)}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{process.cpuPercent.toFixed(1)}%</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{formatBytes(process.memoryBytes)}</TableCell>
                  <TableCell align="right">{process.threads}</TableCell>
                  <TableCell align="right">{process.nice}</TableCell>
                  <TableCell>
                    <Tooltip title="结束进程">
                      <span>
                        <IconButton size="small" color="error" disabled={process.pid <= 1} onClick={() => setKillTarget(process)}>
                          <DeleteOutline fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Paper>

      <Dialog open={Boolean(killTarget)} onClose={() => setKillTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>结束进程？</DialogTitle>
        <DialogContent>
          将向 {killTarget?.name}（PID {killTarget?.pid}）发送 SIGTERM。系统服务可能自动重新启动。
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setKillTarget(null)}>取消</Button>
          <Button
            color="error"
            variant="contained"
            onClick={async () => {
              if (!killTarget) return;
              try {
                await backend.killProcess(killTarget.pid, 15);
                setKillTarget(null);
              } catch (cause) {
                setError(String(cause));
                setKillTarget(null);
              }
            }}
          >结束</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function Metric({ label, value, percent, icon, color = "primary" }: { label: string; value: string; percent?: number; icon: React.ReactNode; color?: "primary" | "success" | "warning" | "error" }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.75, minHeight: 92 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Box sx={{ display: "flex", color: `${color}.main` }}>{icon}</Box>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{label}</Typography>
      </Stack>
      <Typography variant="h2" sx={{ fontVariantNumeric: "tabular-nums", mb: percent == null ? 0 : 1 }}>{value}</Typography>
      {percent != null && <LinearProgress variant="determinate" value={percent} color={color} sx={{ height: 6, borderRadius: 3 }} />}
    </Paper>
  );
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024).toFixed(0)} KiB`;
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days ? `${days} 天 ` : ""}${hours} 小时 ${minutes} 分钟`;
}

function stateLabel(state: string) {
  return ({ R: "运行", S: "休眠", D: "等待 I/O", Z: "僵尸", T: "停止", I: "空闲" } as Record<string, string>)[state] ?? state;
}
