import {
  ArchiveOutlined,
  CheckCircleOutlined,
  DeleteOutline,
  ErrorOutline,
  ExtensionOutlined,
  RefreshOutlined,
  RestartAltOutlined,
  UploadFileOutlined,
  WarningAmberOutlined,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Snackbar,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { backend } from "../backend";
import EmptyState from "../components/EmptyState";
import { useAppState } from "../state";
import type { ArchivePlugin, PluginInfo } from "../types";

export default function PluginsPage() {
  const connected = useAppState((state) => state.device.connected);
  const queryClient = useQueryClient();
  const pluginsQuery = useQuery({ queryKey: ["plugins"], queryFn: backend.listPlugins, enabled: connected });
  const [archivePath, setArchivePath] = useState("");
  const [archivePlugins, setArchivePlugins] = useState<ArchivePlugin[]>([]);
  const [removeTarget, setRemoveTarget] = useState<PluginInfo | null>(null);
  const [message, setMessage] = useState("");
  const [installOpen, setInstallOpen] = useState(false);

  if (!connected) {
    return <EmptyState icon={<ExtensionOutlined />} title="连接后管理插件" description="扫描、启停、移除和安装 PenMods 插件。" />;
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["plugins"] });

  const chooseArchive = async () => {
    const path = await open({ multiple: false, filters: [{ name: "ZIP 存档", extensions: ["zip"] }] });
    if (!path || Array.isArray(path)) return;
    try {
      const discovered = await backend.inspectPluginArchive(path);
      setArchivePath(path);
      setArchivePlugins(discovered.map((plugin) => ({ ...plugin, selected: true })));
      setInstallOpen(true);
    } catch (error) {
      setMessage(String(error));
    }
  };

  const install = async (enable: boolean) => {
    const ids = archivePlugins.filter((plugin) => plugin.selected).map((plugin) => plugin.id);
    if (!ids.length) return;
    try {
      await backend.installPluginArchive(archivePath, ids, enable);
      setInstallOpen(false);
      setMessage(`已安装 ${ids.length} 个插件，重启主程序后生效`);
      refresh();
    } catch (error) {
      setMessage(String(error));
    }
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Button variant="contained" startIcon={<UploadFileOutlined />} onClick={chooseArchive}>安装 ZIP</Button>
        <Button color="inherit" startIcon={<RefreshOutlined />} onClick={refresh}>重新扫描</Button>
        <Box sx={{ flex: 1 }} />
        <Typography variant="body2" color="text.secondary">插件目录：/userdisk/PenMods/plugins</Typography>
      </Stack>

      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        <Box sx={{ px: 2, py: 1.25, bgcolor: "#f7f8f9", borderBottom: "1px solid", borderColor: "divider" }}>
          <Typography variant="body2" color="text.secondary">
            {pluginsQuery.data?.length ?? 0} 个插件
          </Typography>
        </Box>
        {pluginsQuery.isError && <Alert severity="error">{String(pluginsQuery.error)}</Alert>}
        <List disablePadding>
          {(pluginsQuery.data ?? []).map((plugin, index, all) => (
            <Box key={plugin.id}>
              <ListItem
                sx={{ px: 2, py: 1.25, minHeight: 76 }}
                secondaryAction={
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <Tooltip title={plugin.enabled ? "禁用插件" : "启用插件"}>
                      <Switch
                        checked={plugin.enabled}
                        onChange={async (_, enabled) => {
                          try {
                            await backend.setPluginEnabled(plugin.id, enabled);
                            setMessage(`${plugin.name} 已${enabled ? "启用" : "禁用"}，重启主程序后生效`);
                            refresh();
                          } catch (error) {
                            setMessage(String(error));
                          }
                        }}
                      />
                    </Tooltip>
                    <Tooltip title="移除插件">
                      <IconButton color="error" onClick={() => setRemoveTarget(plugin)}>
                        <DeleteOutline />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                }
              >
                <ListItemIcon sx={{ minWidth: 48 }}>
                  <Box sx={{ width: 36, height: 36, borderRadius: 1, bgcolor: plugin.native ? "#fce8e6" : "#e6f4ea", display: "grid", placeItems: "center", color: plugin.native ? "error.main" : "secondary.main" }}>
                    <ExtensionOutlined />
                  </Box>
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography fontWeight={600}>{plugin.name || plugin.id}</Typography>
                      <Typography variant="caption" color="text.secondary">{plugin.version || "未知版本"}</Typography>
                      <PluginStatus plugin={plugin} />
                      {plugin.native && <Chip label="原生 Hook" size="small" color="warning" variant="outlined" />}
                    </Stack>
                  }
                  secondary={
                    <Box sx={{ mt: 0.4, maxWidth: "70%" }}>
                      {plugin.description && (
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {plugin.description}
                        </Typography>
                      )}
                      <Typography variant="caption" color="text.secondary" noWrap component="div">
                        {plugin.author?.trim() ? `作者：${plugin.author.trim()} · ` : ""}{plugin.id}
                      </Typography>
                    </Box>
                  }
                  secondaryTypographyProps={{ component: "div" }}
                />
              </ListItem>
              {index < all.length - 1 && <Divider component="li" />}
            </Box>
          ))}
        </List>
        {!pluginsQuery.isLoading && !pluginsQuery.data?.length && (
          <Box sx={{ py: 7, textAlign: "center", color: "text.secondary" }}>未发现已安装插件</Box>
        )}
      </Paper>

      {(pluginsQuery.data ?? []).some((plugin) => plugin.restartRequired) && (
        <Alert severity="info" icon={<RestartAltOutlined />} action={<Button size="small" onClick={backend.restartMainApp}>立即重启</Button>}>
          插件配置已更改，需要重启 YoudaoDictPen 才能确认运行状态。
        </Alert>
      )}

      <Dialog open={installOpen} onClose={() => setInstallOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>选择要安装的插件</DialogTitle>
        <DialogContent sx={{ px: 0 }}>
          <Alert severity="info" sx={{ mx: 3, mb: 1.5 }}>
            已递归检查 ZIP，并将每个包含有效 metadata.json 的目录识别为独立插件。
          </Alert>
          <List disablePadding>
            {archivePlugins.map((plugin) => (
              <ListItemButton
                key={`${plugin.archiveRoot}:${plugin.id}`}
                onClick={() => setArchivePlugins((items) => items.map((item) => item === plugin ? { ...item, selected: !item.selected } : item))}
              >
                <ListItemIcon><Checkbox checked={plugin.selected} /></ListItemIcon>
                <ListItemText
                  primary={`${plugin.name || plugin.id} ${plugin.version ? `· ${plugin.version}` : ""}`}
                  secondary={`${plugin.author?.trim() ? `作者：${plugin.author.trim()} · ` : ""}${plugin.archiveRoot || "ZIP 根目录"} · ${plugin.native ? "包含原生库" : "纯 QML"}`}
                />
                {plugin.health !== "ok" && <WarningAmberOutlined color="warning" />}
              </ListItemButton>
            ))}
          </List>
          {!archivePlugins.length && <Box sx={{ p: 4, textAlign: "center" }}>存档内没有发现插件</Box>}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setInstallOpen(false)}>取消</Button>
          <Button onClick={() => install(false)} disabled={!archivePlugins.some((item) => item.selected)}>安装为禁用</Button>
          <Button variant="contained" onClick={() => install(true)} disabled={!archivePlugins.some((item) => item.selected)}>安装并启用</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(removeTarget)} onClose={() => setRemoveTarget(null)} fullWidth maxWidth="xs">
        <DialogTitle>移除插件？</DialogTitle>
        <DialogContent>将删除 {removeTarget?.name || removeTarget?.id} 的整个插件目录。已有版本会在本次会话中保留一份回滚备份。</DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setRemoveTarget(null)}>取消</Button>
          <Button
            color="error"
            variant="contained"
            onClick={async () => {
              if (!removeTarget) return;
              await backend.removePlugin(removeTarget.id);
              setRemoveTarget(null);
              setMessage("插件已移除，重启主程序后生效");
              refresh();
            }}
          >移除</Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={Boolean(message)} autoHideDuration={4500} onClose={() => setMessage("")} message={message} />
    </Stack>
  );
}

function PluginStatus({ plugin }: { plugin: PluginInfo }) {
  if (plugin.health !== "ok") {
    return <Chip icon={<ErrorOutline />} label={plugin.health === "loading-marker" ? "上次加载失败" : "异常"} size="small" color="error" variant="outlined" />;
  }
  if (plugin.restartRequired) return <Chip icon={<RestartAltOutlined />} label="等待重启" size="small" color="info" variant="outlined" />;
  if (plugin.loaded) return <Chip icon={<CheckCircleOutlined />} label="已加载" size="small" color="success" variant="outlined" />;
  return <Chip label={plugin.enabled ? "已配置启用" : "已禁用"} size="small" variant="outlined" />;
}
