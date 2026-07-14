import { AddOutlined, CloseOutlined, TerminalOutlined } from "@mui/icons-material";
import { Box, IconButton, Paper, Stack, Tab, Tabs, Tooltip } from "@mui/material";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { backend } from "../backend";
import EmptyState from "../components/EmptyState";
import { useAppState } from "../state";

interface SessionTab {
  id: string;
  title: string;
}

export default function TerminalPage() {
  const connected = useAppState((state) => state.device.connected);
  const [sessions, setSessions] = useState<SessionTab[]>([{ id: "main", title: "设备 Shell" }]);
  const [active, setActive] = useState("main");

  if (!connected) {
    return <EmptyState icon={<TerminalOutlined />} title="连接后使用终端" description="终端命令通过当前 ADB 或 SSH 连接在设备上执行。" />;
  }

  return (
    <Paper variant="outlined" sx={{ height: "100%", minHeight: 520, display: "grid", gridTemplateRows: "42px minmax(0, 1fr)", bgcolor: "#16181d", overflow: "hidden" }}>
      <Stack direction="row" alignItems="center" sx={{ bgcolor: "#25282f", borderBottom: "1px solid #343841" }}>
        <Tabs value={active} onChange={(_, value) => setActive(value)} sx={{ minHeight: 42, flex: 1, "& .MuiTab-root": { minHeight: 42, color: "#c2c7d0" }, "& .Mui-selected": { color: "white !important" } }}>
          {sessions.map((session) => (
            <Tab key={session.id} value={session.id} label={session.title} iconPosition="start" icon={<TerminalOutlined fontSize="small" />} />
          ))}
        </Tabs>
        <Tooltip title="新建终端">
          <IconButton
            size="small"
            sx={{ color: "#c2c7d0", mr: 0.5 }}
            onClick={() => {
              const id = crypto.randomUUID();
              setSessions((items) => [...items, { id, title: `Shell ${items.length + 1}` }]);
              setActive(id);
            }}
          >
            <AddOutlined />
          </IconButton>
        </Tooltip>
        <Tooltip title="关闭终端">
          <span>
            <IconButton
              size="small"
              disabled={sessions.length === 1}
              sx={{ color: "#c2c7d0", mr: 0.75 }}
              onClick={() => {
                const index = sessions.findIndex((session) => session.id === active);
                const next = sessions.filter((session) => session.id !== active);
                setSessions(next);
                setActive(next[Math.max(0, index - 1)].id);
              }}
            >
              <CloseOutlined />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      {sessions.map((session) => (
        <Box key={session.id} sx={{ minHeight: 0, height: "100%", display: active === session.id ? "block" : "none" }}>
          <TerminalView sessionId={session.id} active={active === session.id} />
        </Box>
      ))}
    </Paper>
  );
}

interface TerminalOutput {
  sessionId: string;
  data: string;
  closed: boolean;
}

function TerminalView({ sessionId, active }: { sessionId: string; active: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const startedRef = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!active) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const element = container.current;
        const terminal = terminalRef.current;
        const fit = fitRef.current;
        if (!element || !terminal || !fit || element.clientWidth < 2 || element.clientHeight < 2) return;
        fit.fit();
        terminal.refresh(0, Math.max(0, terminal.rows - 1));
        terminal.focus();
        if (startedRef.current) void backend.resizeTerminal(sessionId, terminal.cols, terminal.rows);
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [active, sessionId]);

  useEffect(() => {
    if (!container.current) return;
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
      theme: { background: "#16181d", foreground: "#e5e7eb", cursor: "#8ab4f8", selectionBackground: "#3f4654" },
      scrollback: 4000,
    });
    const fit = new FitAddon();
    terminalRef.current = terminal;
    fitRef.current = fit;
    terminal.loadAddon(fit);
    terminal.open(container.current);
    if (container.current.clientWidth >= 2 && container.current.clientHeight >= 2) fit.fit();
    terminal.writeln("\x1b[90m正在建立设备终端...\x1b[0m");

    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    let started = false;
    const input = terminal.onData((data) => {
      if (started) void backend.terminalInput(sessionId, data);
    });
    void (async () => {
      try {
        unlisten = await listen<TerminalOutput>("terminal-output", (event) => {
          if (event.payload.sessionId !== sessionId) return;
          if (event.payload.data) terminal.write(event.payload.data);
          if (event.payload.closed) terminal.writeln("\r\n\x1b[90m终端会话已关闭\x1b[0m");
        });
        if (disposed) {
          unlisten();
          return;
        }
        terminal.clear();
        await backend.startTerminal(sessionId, terminal.cols, terminal.rows);
        started = true;
        startedRef.current = true;
        terminal.focus();
      } catch (error) {
        terminal.writeln(`\r\n\x1b[31m${String(error)}\x1b[0m`);
      }
    })();
    const resize = new ResizeObserver(() => {
      const element = container.current;
      if (!activeRef.current || !element || element.clientWidth < 2 || element.clientHeight < 2) return;
      fit.fit();
      terminal.refresh(0, Math.max(0, terminal.rows - 1));
      if (started) void backend.resizeTerminal(sessionId, terminal.cols, terminal.rows);
    });
    resize.observe(container.current);

    return () => {
      input.dispose();
      resize.disconnect();
      disposed = true;
      startedRef.current = false;
      unlisten?.();
      if (started) void backend.closeTerminal(sessionId);
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId]);

  return <Box ref={container} sx={{ width: "100%", height: "100%" }} />;
}
