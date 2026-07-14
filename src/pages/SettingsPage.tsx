import { GitHub, SecurityOutlined, SystemUpdateAltOutlined } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { backend } from "../backend";
import { useAppState } from "../state";

export default function SettingsPage() {
  const { penmodsSource, setPenmodsSource } = useAppState();
  const [draft, setDraft] = useState(penmodsSource);
  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<{ version: string; commit?: string; publishedAt?: string } | null>(null);
  const [updateMessage, setUpdateMessage] = useState("");

  return (
    <Stack spacing={2.5} sx={{ maxWidth: 860 }}>
      <Card>
        <CardContent sx={{ p: 0, "&:last-child": { pb: 0 } }}>
          <Stack direction="row" spacing={1.25} alignItems="center" sx={{ px: 2.5, py: 2 }}>
            <GitHub color="primary" />
            <Box>
              <Typography variant="h2">PenMods 更新源</Typography>
              <Typography variant="body2" color="text.secondary">
                默认获取 Lyrecoul/PenMods 构建，也可以使用兼容的自定义仓库。
              </Typography>
            </Box>
          </Stack>
          <Divider />
          <Stack spacing={2} sx={{ p: 2.5 }}>
            <TextField
              label="GitHub 仓库"
              value={draft.repository}
              onChange={(event) => setDraft({ ...draft, repository: event.target.value })}
              helperText="格式：owner/repository"
            />
            <Stack direction="row" spacing={1.5}>
              <TextField
                select
                label="更新渠道"
                value={draft.channel}
                onChange={(event) => setDraft({ ...draft, channel: event.target.value as "release" | "ci" })}
                sx={{ width: 180 }}
              >
                <MenuItem value="release">GitHub Release</MenuItem>
                <MenuItem value="ci">最新 CI 构建</MenuItem>
              </TextField>
              <TextField
                label="分支"
                value={draft.branch}
                onChange={(event) => setDraft({ ...draft, branch: event.target.value })}
                fullWidth
              />
              <TextField
                label="设备平台"
                value={draft.platform}
                onChange={(event) => setDraft({ ...draft, platform: event.target.value })}
                sx={{ width: 180 }}
              />
            </Stack>
            {draft.channel === "ci" && (
              <TextField
                label="Workflow 文件"
                value={draft.workflow}
                onChange={(event) => setDraft({ ...draft, workflow: event.target.value })}
              />
            )}
            <TextField
              label="GitHub Token"
              type="password"
              value={draft.token ?? ""}
              onChange={(event) => setDraft({ ...draft, token: event.target.value || undefined })}
              helperText="下载 Actions 产物时需要；保存后写入系统凭据存储。"
            />
            <Box>
              <Button variant="contained" onClick={() => setPenmodsSource(draft)}>
                保存更新源
              </Button>
              <Button
                startIcon={<SystemUpdateAltOutlined />}
                disabled={checking}
                onClick={async () => {
                  setChecking(true);
                  setUpdateMessage("");
                  try {
                    setUpdate(await backend.checkPenmodsUpdate(draft));
                  } catch (error) {
                    setUpdateMessage(String(error));
                  } finally {
                    setChecking(false);
                  }
                }}
                sx={{ ml: 1 }}
              >
                {checking ? "正在检查" : "检查更新"}
              </Button>
            </Box>
            {update && (
              <Alert
                severity="success"
                action={
                  <Button
                    size="small"
                    onClick={async () => {
                      try {
                        await backend.installPenmodsUpdate(draft);
                        setUpdateMessage("PenMods 已升级；请连接设备并重启主程序使新版本生效");
                      } catch (error) {
                        setUpdateMessage(String(error));
                      }
                    }}
                  >
                    下载并安装
                  </Button>
                }
              >
                找到 {update.version}{update.commit ? ` · ${update.commit.slice(0, 8)}` : ""}
              </Alert>
            )}
            {updateMessage && <Alert severity={updateMessage.startsWith("PenMods") ? "success" : "warning"}>{updateMessage}</Alert>}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={{ p: 2.5 }}>
          <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1.5 }}>
            <SecurityOutlined color="primary" />
            <Typography variant="h2">连接与安全</Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            仓库和构建渠道保存在本地。SSH 密码与 GitHub Token 仅保留在当前应用会话，不写入配置文件。
          </Typography>
        </CardContent>
      </Card>

      <Alert severity="warning">
        原生 Hook 插件与 PenMods 库具有设备主程序内的完整代码执行权限。只安装来源可信且哈希匹配的构建。
      </Alert>
    </Stack>
  );
}
