import { DownloadOutlined, ExtensionOutlined, GitHub, OpenInNewOutlined, RefreshOutlined, SearchOutlined, StorefrontOutlined } from "@mui/icons-material";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  InputAdornment,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMemo, useState } from "react";
import { backend } from "../backend";
import type { MarketIndex } from "../types";

const defaultMarket = "https://raw.githubusercontent.com/Lyrecoul/PenMods-Registry/main/index.json";

export default function MarketPage() {
  const [source, setSource] = useState(defaultMarket);
  const [index, setIndex] = useState<MarketIndex | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setIndex(await backend.loadMarket(source));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
    }
  };

  const plugins = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return index?.plugins ?? [];
    return (index?.plugins ?? []).filter((plugin) => `${plugin.name} ${plugin.id} ${plugin.summary} ${plugin.author ?? ""}`.toLocaleLowerCase().includes(needle));
  }, [index, query]);

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack direction="row" spacing={1.25}>
          <TextField
            size="small"
            label="市场索引 URL"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            fullWidth
            InputProps={{ startAdornment: <InputAdornment position="start"><GitHub fontSize="small" /></InputAdornment> }}
          />
          <Button variant="contained" startIcon={<RefreshOutlined />} onClick={load} disabled={loading}>加载市场</Button>
        </Stack>
      </Paper>

      {error && <Alert severity="warning">{error}。市场尚未发布时，可以在设置中添加其他兼容索引。</Alert>}

      <Stack direction="row" alignItems="center">
        <Box sx={{ flex: 1 }}>
          <Typography variant="h2">{index?.name || "插件目录"}</Typography>
          <Typography variant="body2" color="text.secondary">{index ? `${plugins.length} 个可用插件` : "加载一个市场源以浏览插件"}</Typography>
        </Box>
        <TextField
          size="small"
          placeholder="搜索插件"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          sx={{ width: 260 }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchOutlined fontSize="small" /></InputAdornment> }}
        />
      </Stack>

      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(320px, 1fr))", gap: 1.5 }}>
        {plugins.map((plugin) => {
          const version = plugin.versions[0];
          return (
            <Paper key={plugin.id} variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" spacing={1.5} alignItems="flex-start">
                <Avatar variant="rounded" src={plugin.icon} sx={{ width: 44, height: 44, bgcolor: "#e8f0fe", color: "primary.main" }}>
                  <ExtensionOutlined />
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" alignItems="center" spacing={0.75}>
                    <Typography variant="h3" noWrap>{plugin.name}</Typography>
                    {version?.native && <Chip label="原生" size="small" color="warning" variant="outlined" />}
                  </Stack>
                  <Typography variant="caption" color="text.secondary">{plugin.author || plugin.id} · {version?.version || "未知版本"}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1, minHeight: 38 }}>{plugin.summary}</Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<DownloadOutlined />}
                      disabled={!version}
                      onClick={async () => {
                        if (!version) return;
                        try {
                          await backend.installMarketPlugin(version.url, version.sha256, version.roots, true);
                          setMessage(`${plugin.name} 已安装，重启主程序后生效`);
                        } catch (cause) {
                          setMessage(String(cause));
                        }
                      }}
                    >安装</Button>
                    {plugin.repository && (
                      <Button
                        size="small"
                        color="inherit"
                        endIcon={<OpenInNewOutlined />}
                        component="a"
                        href={`https://github.com/${plugin.repository}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        项目主页
                      </Button>
                    )}
                  </Stack>
                </Box>
              </Stack>
            </Paper>
          );
        })}
      </Box>

      {!index && !error && (
        <Box sx={{ minHeight: 280, display: "grid", placeItems: "center", textAlign: "center", color: "text.secondary" }}>
          <Box><StorefrontOutlined sx={{ fontSize: 46, mb: 1 }} /><Typography>插件市场采用可配置的静态索引，不依赖中心服务。</Typography></Box>
        </Box>
      )}
      <Snackbar open={Boolean(message)} autoHideDuration={4500} onClose={() => setMessage("")} message={message} />
    </Stack>
  );
}
