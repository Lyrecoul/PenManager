import {
  ArrowBackOutlined,
  ChevronRightOutlined,
  CreateNewFolderOutlined,
  DeleteOutline,
  DownloadOutlined,
  DriveFileRenameOutline,
  FolderOutlined,
  InsertDriveFileOutlined,
  MoreVert,
  RefreshOutlined,
  UploadOutlined,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Link,
  Menu,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { useMemo, useState } from "react";
import { backend } from "../backend";
import EmptyState from "../components/EmptyState";
import { useAppState } from "../state";
import type { RemoteFile } from "../types";

const initialPath = "/userdisk";

export default function FilesPage() {
  const connected = useAppState((state) => state.device.connected);
  const [path, setPath] = useState(initialPath);
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<"mkdir" | "rename" | "delete" | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const queryClient = useQueryClient();
  const filesQuery = useQuery({
    queryKey: ["files", path],
    queryFn: () => backend.listFiles(path),
    enabled: connected,
  });

  const files = useMemo(
    () => [...(filesQuery.data ?? [])].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, "zh-CN", { numeric: true }) : a.kind === "directory" ? -1 : 1)),
    [filesQuery.data],
  );

  if (!connected) {
    return <EmptyState icon={<FolderOutlined />} title="连接后浏览文件" description="文件管理支持上传、下载、新建目录、重命名和删除。" />;
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["files", path] });
  const enter = (file: RemoteFile) => {
    if (file.kind !== "directory") return;
    setPath(file.path);
    setSelected([]);
  };
  const parent = path === "/" ? "/" : path.slice(0, path.lastIndexOf("/")) || "/";
  const selectedFile = files.find((file) => selected[0] === file.path);

  const upload = async () => {
    const result = await open({ multiple: true, directory: false });
    if (!result) return;
    const paths = Array.isArray(result) ? result : [result];
    try {
      await backend.uploadFiles(paths, path);
      setMessage(`已上传 ${paths.length} 个文件`);
      refresh();
    } catch (error) {
      setMessage(String(error));
    }
  };

  const download = async () => {
    if (!selected.length) return;
    const target = await open({ directory: true, multiple: false });
    if (!target || Array.isArray(target)) return;
    try {
      await backend.downloadFiles(selected, target);
      setMessage(`已下载 ${selected.length} 项`);
    } catch (error) {
      setMessage(String(error));
    }
  };

  const submitDialog = async () => {
    try {
      if (dialog === "mkdir") await backend.createDirectory(joinRemote(path, name));
      if (dialog === "rename" && selectedFile) await backend.renamePath(selectedFile.path, name);
      if (dialog === "delete") await backend.removePaths(selected);
      setMessage(dialog === "delete" ? "所选项目已删除" : "操作完成");
      setDialog(null);
      setSelected([]);
      setName("");
      refresh();
    } catch (error) {
      setMessage(String(error));
    }
  };

  return (
    <Paper variant="outlined" sx={{ height: "100%", minHeight: 520, display: "grid", gridTemplateRows: "auto auto minmax(0, 1fr)" }}>
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ p: 1, borderBottom: "1px solid", borderColor: "divider" }}>
        <Tooltip title="上一级">
          <span>
            <IconButton size="small" disabled={path === "/"} onClick={() => { setPath(parent); setSelected([]); }}>
              <ArrowBackOutlined />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="刷新">
          <IconButton size="small" onClick={refresh}>
            <RefreshOutlined />
          </IconButton>
        </Tooltip>
        <Box sx={{ flex: 1, minWidth: 0, mx: 0.5 }}>
          <PathBreadcrumbs path={path} onNavigate={(next) => { setPath(next); setSelected([]); }} />
        </Box>
        <Button size="small" startIcon={<UploadOutlined />} onClick={upload}>上传</Button>
        <Button size="small" startIcon={<DownloadOutlined />} disabled={!selected.length} onClick={download}>下载</Button>
        <Button size="small" startIcon={<CreateNewFolderOutlined />} onClick={() => { setDialog("mkdir"); setName(""); }}>新建文件夹</Button>
        <Tooltip title="更多操作">
          <span>
            <IconButton size="small" disabled={!selected.length} onClick={(event) => setMenuAnchor(event.currentTarget)}>
              <MoreVert />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Box sx={{ px: 1.75, py: 0.75, bgcolor: "#f7f8f9", borderBottom: "1px solid", borderColor: "divider" }}>
        <Typography variant="caption" color="text.secondary">
          {files.length} 项{selected.length ? ` · 已选择 ${selected.length} 项` : ""}
        </Typography>
      </Box>

      <Box sx={{ overflow: "auto" }}>
        {filesQuery.isError && <Alert severity="error">{String(filesQuery.error)}</Alert>}
        <Table stickyHeader size="small" aria-label="远程文件">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  size="small"
                  checked={files.length > 0 && selected.length === files.length}
                  indeterminate={selected.length > 0 && selected.length < files.length}
                  onChange={(_, checked) => setSelected(checked ? files.map((file) => file.path) : [])}
                />
              </TableCell>
              <TableCell>名称</TableCell>
              <TableCell width={130}>大小</TableCell>
              <TableCell width={180}>修改时间</TableCell>
              <TableCell width={110}>权限</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {files.map((file) => (
              <TableRow
                key={file.path}
                hover
                selected={selected.includes(file.path)}
                onDoubleClick={() => enter(file)}
                sx={{ cursor: file.kind === "directory" ? "pointer" : "default" }}
              >
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    checked={selected.includes(file.path)}
                    onChange={(_, checked) => setSelected((current) => checked ? [...current, file.path] : current.filter((item) => item !== file.path))}
                  />
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={1.25} alignItems="center">
                    {file.kind === "directory" ? <FolderOutlined color="primary" fontSize="small" /> : <InsertDriveFileOutlined color="action" fontSize="small" />}
                    {file.kind === "directory" ? (
                      <Button
                        color="inherit"
                        size="small"
                        onClick={(event) => {
                          event.stopPropagation();
                          enter(file);
                        }}
                        endIcon={<ChevronRightOutlined fontSize="small" />}
                        sx={{ minWidth: 0, maxWidth: "100%", justifyContent: "flex-start", px: 0.5 }}
                      >
                        <Typography variant="body2" noWrap>{file.name}</Typography>
                      </Button>
                    ) : (
                      <Typography variant="body2" noWrap>{file.name}</Typography>
                    )}
                  </Stack>
                </TableCell>
                <TableCell>{file.kind === "directory" ? "-" : formatBytes(file.size)}</TableCell>
                <TableCell>{file.modified ? new Date(file.modified * 1000).toLocaleString() : "-"}</TableCell>
                <TableCell sx={{ fontFamily: "monospace" }}>{file.mode || "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!filesQuery.isLoading && !filesQuery.isError && !files.length && (
          <Box sx={{ py: 8, textAlign: "center", color: "text.secondary" }}>此文件夹为空</Box>
        )}
      </Box>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem disabled={selected.length !== 1} onClick={() => { setName(selectedFile?.name ?? ""); setDialog("rename"); setMenuAnchor(null); }}>
          <DriveFileRenameOutline fontSize="small" sx={{ mr: 1.25 }} />重命名
        </MenuItem>
        <MenuItem sx={{ color: "error.main" }} onClick={() => { setDialog("delete"); setMenuAnchor(null); }}>
          <DeleteOutline fontSize="small" sx={{ mr: 1.25 }} />删除
        </MenuItem>
      </Menu>

      <Dialog open={dialog !== null} onClose={() => setDialog(null)} fullWidth maxWidth="xs">
        <DialogTitle>{dialog === "mkdir" ? "新建文件夹" : dialog === "rename" ? "重命名" : "删除所选项目？"}</DialogTitle>
        <DialogContent>
          {dialog === "delete" ? (
            <Typography>将永久删除 {selected.length} 个项目，此操作无法撤销。</Typography>
          ) : (
            <TextField autoFocus fullWidth label="名称" value={name} onChange={(event) => setName(event.target.value)} sx={{ mt: 1 }} />
          )}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setDialog(null)}>取消</Button>
          <Button variant="contained" color={dialog === "delete" ? "error" : "primary"} disabled={dialog !== "delete" && !name.trim()} onClick={submitDialog}>
            {dialog === "delete" ? "删除" : "确认"}
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={Boolean(message)} autoHideDuration={4000} onClose={() => setMessage("")} message={message} />
    </Paper>
  );
}

function PathBreadcrumbs({ path, onNavigate }: { path: string; onNavigate: (path: string) => void }) {
  const segments = path.split("/").filter(Boolean);
  return (
    <Breadcrumbs maxItems={5} sx={{ "& .MuiBreadcrumbs-ol": { flexWrap: "nowrap" } }}>
      <Link component="button" underline="hover" color="inherit" onClick={() => onNavigate("/")}>根目录</Link>
      {segments.map((segment, index) => {
        const target = `/${segments.slice(0, index + 1).join("/")}`;
        return index === segments.length - 1 ? (
          <Typography key={target} color="text.primary" fontWeight={600} noWrap>{segment}</Typography>
        ) : (
          <Link key={target} component="button" underline="hover" color="inherit" onClick={() => onNavigate(target)}>{segment}</Link>
        );
      })}
    </Breadcrumbs>
  );
}

function joinRemote(parent: string, name: string) {
  return parent === "/" ? `/${name}` : `${parent}/${name}`;
}

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}
