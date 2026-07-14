import {
  CodeOutlined,
  RefreshOutlined,
  RestartAltOutlined,
  SaveOutlined,
  TuneOutlined,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { backend } from "../backend";
import EmptyState from "../components/EmptyState";
import { useAppState } from "../state";

type ConfigObject = Record<string, unknown>;
type FieldKind = "boolean" | "text" | "password" | "number" | "select";

interface ConfigField {
  path: string;
  label: string;
  kind: FieldKind;
  options?: Array<{ value: number | string; label: string }>;
  min?: number;
  max?: number;
}

interface ConfigGroup {
  id: string;
  label: string;
  fields: ConfigField[];
}

const groups: ConfigGroup[] = [
  {
    id: "query",
    label: "查词与单词本",
    fields: [
      { path: "query.lower_scan", label: "扫描结果转小写", kind: "boolean" },
      { path: "query.type_by_hand", label: "允许手动输入查词", kind: "boolean" },
      { path: "wordbook.phrase_tab", label: "启用词组页签", kind: "boolean" },
      { path: "wordbook.nocase_sensitive", label: "单词本忽略大小写", kind: "boolean" },
      { path: "column_db.patch", label: "启用列式数据库补丁", kind: "boolean" },
    ],
  },
  {
    id: "power",
    label: "屏幕与电源",
    fields: [
      { path: "screen.sleep_duration", label: "息屏时间（秒）", kind: "number", min: 0, max: 3600 },
      { path: "screen.intel_sleep", label: "智能息屏", kind: "boolean" },
      { path: "screen.intel_sleep_audio_lock", label: "播放音频时保持亮屏", kind: "boolean" },
      { path: "battery.suspend_duration", label: "自动休眠时间（秒）", kind: "number", min: 0, max: 86400 },
    ],
  },
  {
    id: "privacy",
    label: "隐私与日志",
    fields: [
      { path: "logger.no_upload_user_action", label: "阻止上传用户操作", kind: "boolean" },
      { path: "logger.no_upload_raw_scan_img", label: "阻止上传原始扫描图像", kind: "boolean" },
      { path: "logger.no_upload_httplog", label: "阻止上传网络日志", kind: "boolean" },
      { path: "dev.offline_rm", label: "离线资源管理", kind: "boolean" },
      { path: "capture.enabled", label: "启用相机捕获模块", kind: "boolean" },
    ],
  },
  {
    id: "network",
    label: "网络与服务",
    fields: [
      { path: "serv.ssh_autorun", label: "开机启动 SSH", kind: "boolean" },
      { path: "serv.adb_autorun", label: "开机启动 ADB", kind: "boolean" },
      { path: "serv.adb_skip_verification", label: "跳过 ADB 验证", kind: "boolean" },
      { path: "net.proxy_enabled", label: "启用网络代理", kind: "boolean" },
      {
        path: "net.proxy_type",
        label: "代理类型",
        kind: "select",
        options: [
          { value: 0, label: "SOCKS5" },
          { value: 1, label: "HTTP" },
        ],
      },
      { path: "net.proxy_hostname", label: "代理主机", kind: "text" },
      { path: "net.proxy_port", label: "代理端口", kind: "number", min: 1, max: 65535 },
      { path: "net.proxy_username", label: "代理用户名", kind: "text" },
      { path: "net.proxy_password", label: "代理密码", kind: "password" },
    ],
  },
  {
    id: "files",
    label: "文件与壁纸",
    fields: [
      { path: "fm.show_hidden_files", label: "显示隐藏文件", kind: "boolean" },
      { path: "fm.hide_paired_lyrics", label: "隐藏配对歌词", kind: "boolean" },
      { path: "fm.order.reversed", label: "反向排序", kind: "boolean" },
      {
        path: "fm.order.basic",
        label: "排序依据",
        kind: "select",
        options: [
          { value: 0, label: "名称" },
          { value: 1, label: "修改时间" },
          { value: 2, label: "大小" },
          { value: 128, label: "类型" },
          { value: 65536, label: "自然排序" },
        ],
      },
      {
        path: "wallpaper.mode",
        label: "壁纸模式",
        kind: "select",
        options: [
          { value: 0, label: "关闭" },
          { value: 1, label: "单张" },
          { value: 2, label: "轮播" },
        ],
      },
      { path: "wallpaper.custom_image_path", label: "自定义壁纸路径", kind: "text" },
      { path: "wallpaper.wallpaper_folder", label: "轮播壁纸目录", kind: "text" },
      { path: "wallpaper.cycle_interval", label: "轮播间隔（秒）", kind: "number", min: 10, max: 86400 },
    ],
  },
  {
    id: "safety",
    label: "安全与行为",
    fields: [
      { path: "locker.enabled", label: "启用安全锁", kind: "boolean" },
      { path: "locker.password", label: "安全锁密码", kind: "password" },
      { path: "locker.scene.screen_on", label: "亮屏时验证", kind: "boolean" },
      { path: "locker.scene.restart", label: "重启后验证", kind: "boolean" },
      { path: "locker.scene.reset_page", label: "保护重置页面", kind: "boolean" },
      { path: "locker.scene.dev_setting", label: "保护开发者设置", kind: "boolean" },
      { path: "locker.scene.filemanager", label: "保护文件管理器", kind: "boolean" },
      { path: "antiembs.auto_mute", label: "蓝牙断开自动静音", kind: "boolean" },
      { path: "antiembs.low_voice", label: "降低最低音量", kind: "boolean" },
      { path: "antiembs.no_auto_pron", label: "禁用自动发音", kind: "boolean" },
      { path: "antiembs.fast_hide_music", label: "快速隐藏音乐", kind: "boolean" },
    ],
  },
  {
    id: "ai",
    label: "AI 功能",
    fields: [
      { path: "ai.auto_send_scan", label: "自动发送扫描内容", kind: "boolean" },
      { path: "ai.speech_assistant", label: "语音助手", kind: "boolean" },
      { path: "ai.streaming", label: "流式输出", kind: "boolean" },
      { path: "ai.tavily.enabled", label: "启用 Tavily 搜索", kind: "boolean" },
      { path: "ai.tavily.api_key", label: "Tavily API Key", kind: "password" },
      { path: "ai.tavily.max_results", label: "最大搜索结果数", kind: "number", min: 1, max: 20 },
      { path: "ai.shell_tool.enabled", label: "启用 Shell 工具", kind: "boolean" },
      { path: "ai.shell_tool.timeout_ms", label: "Shell 超时（毫秒）", kind: "number", min: 100, max: 120000 },
      { path: "ai.shell_tool.max_output_bytes", label: "Shell 最大输出字节", kind: "number", min: 256, max: 1048576 },
      { path: "ai.math_render.enabled", label: "启用数学渲染", kind: "boolean" },
      { path: "ai.math_render.server_path", label: "数学渲染服务地址", kind: "text" },
    ],
  },
];

export default function PenModsConfigPage() {
  const connected = useAppState((state) => state.device.connected);
  const [tab, setTab] = useState(groups[0].id);
  const [draft, setDraft] = useState<ConfigObject | null>(null);
  const [raw, setRaw] = useState("");
  const [rawError, setRawError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [restartRequired, setRestartRequired] = useState(false);
  const queryClient = useQueryClient();
  const configQuery = useQuery({ queryKey: ["penmods-config"], queryFn: backend.readPenmodsConfig, enabled: connected });

  useEffect(() => {
    if (!configQuery.data) return;
    const content = clone(configQuery.data.content);
    setDraft(content);
    setRaw(JSON.stringify(content, null, 2));
    setRawError("");
  }, [configQuery.data]);

  const dirty = useMemo(() => {
    if (!draft || !configQuery.data) return false;
    return JSON.stringify(draft) !== JSON.stringify(configQuery.data.content);
  }, [draft, configQuery.data]);

  if (!connected) {
    return <EmptyState icon={<TuneOutlined />} title="连接后编辑 PenMods 配置" description="可视化管理常用配置，并保留完整 JSON 结构。" />;
  }

  const currentGroup = groups.find((group) => group.id === tab);
  const update = (path: string, value: unknown) => {
    if (!draft) return;
    const next = clone(draft);
    setPath(next, path, value);
    setDraft(next);
    setRaw(JSON.stringify(next, null, 2));
    setRawError("");
  };

  const save = async () => {
    if (!draft || !configQuery.data || rawError) return;
    setSaving(true);
    try {
      const result = await backend.writePenmodsConfig(configQuery.data.path, draft);
      setMessage(`配置已保存，备份：${result.backupPath}`);
      setRestartRequired(true);
      await queryClient.invalidateQueries({ queryKey: ["penmods-config"] });
    } catch (cause) {
      setMessage(String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={2} sx={{ maxWidth: 1080 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary">配置文件</Typography>
          <Typography sx={{ fontFamily: "monospace" }} noWrap>{configQuery.data?.path || "正在查找..."}</Typography>
        </Box>
        <Button color="inherit" startIcon={<RefreshOutlined />} onClick={() => void configQuery.refetch()} disabled={configQuery.isFetching}>重新读取</Button>
        <Button variant="contained" startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveOutlined />} onClick={save} disabled={!dirty || saving || Boolean(rawError)}>保存配置</Button>
      </Stack>

      {configQuery.isError && <Alert severity="error">{String(configQuery.error)}</Alert>}
      {restartRequired && (
        <Alert severity="info" action={<Button size="small" startIcon={<RestartAltOutlined />} onClick={backend.restartMainApp}>立即重启</Button>}>
          配置已写入，重启 YoudaoDictPen 后完整生效。
        </Alert>
      )}

      <Paper variant="outlined" sx={{ minHeight: 520, overflow: "hidden" }}>
        <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" scrollButtons="auto" sx={{ px: 1, borderBottom: "1px solid", borderColor: "divider" }}>
          {groups.map((group) => <Tab key={group.id} value={group.id} label={group.label} />)}
          <Tab value="raw" label="原始 JSON" icon={<CodeOutlined fontSize="small" />} iconPosition="start" />
        </Tabs>

        {!draft && !configQuery.isError ? (
          <Box sx={{ minHeight: 420, display: "grid", placeItems: "center" }}><CircularProgress size={28} /></Box>
        ) : tab === "raw" ? (
          <Box sx={{ p: 2 }}>
            <TextField
              value={raw}
              onChange={(event) => {
                const value = event.target.value;
                setRaw(value);
                try {
                  const parsed = JSON.parse(value);
                  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("根节点必须是对象");
                  setDraft(parsed);
                  setRawError("");
                } catch (cause) {
                  setRawError(cause instanceof Error ? cause.message : String(cause));
                }
              }}
              multiline
              minRows={22}
              fullWidth
              error={Boolean(rawError)}
              helperText={rawError || " "}
              InputProps={{ sx: { fontFamily: '"JetBrains Mono", Consolas, monospace', fontSize: 13, lineHeight: 1.55 } }}
            />
          </Box>
        ) : (
          <Box sx={{ p: 2.5 }}>
            <Typography variant="h2" sx={{ mb: 2 }}>{currentGroup?.label}</Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(260px, 1fr))", columnGap: 3, rowGap: 0 }}>
              {currentGroup?.fields.map((field, index) => (
                <Box key={field.path} sx={{ minHeight: 64, py: 1.25, borderTop: index > 1 ? "1px solid" : undefined, borderColor: "divider" }}>
                  <ConfigControl field={field} value={getPath(draft ?? {}, field.path)} onChange={(value) => update(field.path, value)} />
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Paper>
      <Snackbar open={Boolean(message)} autoHideDuration={6000} onClose={() => setMessage("")} message={message} />
    </Stack>
  );
}

function ConfigControl({ field, value, onChange }: { field: ConfigField; value: unknown; onChange: (value: unknown) => void }) {
  if (field.kind === "boolean") {
    return <FormControlLabel control={<Switch checked={Boolean(value)} onChange={(_, checked) => onChange(checked)} />} label={field.label} sx={{ m: 0 }} />;
  }
  if (field.kind === "select") {
    return (
      <TextField select size="small" fullWidth label={field.label} value={value ?? ""} onChange={(event) => {
        const selected = field.options?.find((option) => String(option.value) === event.target.value)?.value;
        onChange(selected ?? event.target.value);
      }}>
        {field.options?.map((option) => <MenuItem key={String(option.value)} value={option.value}>{option.label}</MenuItem>)}
      </TextField>
    );
  }
  return (
    <TextField
      size="small"
      fullWidth
      label={field.label}
      type={field.kind === "password" ? "password" : field.kind === "number" ? "number" : "text"}
      value={value ?? ""}
      inputProps={{ min: field.min, max: field.max }}
      onChange={(event) => onChange(field.kind === "number" ? Number(event.target.value) : event.target.value)}
    />
  );
}

function getPath(object: ConfigObject, path: string) {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return (value as ConfigObject)[key];
  }, object);
}

function setPath(object: ConfigObject, path: string, value: unknown) {
  const keys = path.split(".");
  let current = object;
  for (const key of keys.slice(0, -1)) {
    const child = current[key];
    if (!child || typeof child !== "object" || Array.isArray(child)) current[key] = {};
    current = current[key] as ConfigObject;
  }
  current[keys.at(-1)!] = value;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
