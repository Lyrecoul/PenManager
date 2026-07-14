use crate::error::{AppError, AppResult};
use crate::models::{CommandResult, ConnectionProfile, RemoteFile, TransportKind};
use ssh2::Session;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::Command;

const FIELD_SEPARATOR: char = '\u{1c}';
const SSH_STANDARD_PATH: &str = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

#[derive(Clone, Debug)]
pub struct DeviceConnection {
    pub profile: ConnectionProfile,
    adb_path: Option<PathBuf>,
}

impl DeviceConnection {
    pub fn connect(mut profile: ConnectionProfile) -> AppResult<Self> {
        if profile.id.trim().is_empty() || profile.name.trim().is_empty() {
            return Err(AppError::InvalidProfile("连接配置缺少名称或 ID".into()));
        }
        match profile.transport {
            TransportKind::Adb => {
                let serial = resolve_adb_serial(profile.serial.as_deref())?;
                profile.serial = Some(serial);
            }
            TransportKind::Ssh => {
                if profile.host.as_deref().unwrap_or_default().is_empty() {
                    return Err(AppError::InvalidProfile("SSH 主机不能为空".into()));
                }
            }
        }
        let adb_path = matches!(profile.transport, TransportKind::Adb).then(resolve_adb_program);
        let connection = Self { profile, adb_path };
        connection.exec("true")?;
        Ok(connection)
    }

    pub fn kind(&self) -> TransportKind {
        self.profile.transport
    }

    pub fn exec(&self, command: &str) -> AppResult<CommandResult> {
        match self.profile.transport {
            TransportKind::Adb => self.adb_shell(command),
            TransportKind::Ssh => self.ssh_exec(command),
        }
    }

    pub(crate) fn adb_base(&self) -> Command {
        let mut command =
            Command::new(self.adb_path.as_deref().unwrap_or_else(|| Path::new("adb")));
        if let Some(serial) = &self.profile.serial {
            command.args(["-s", serial]);
        }
        command
    }

    fn adb_shell(&self, remote_command: &str) -> AppResult<CommandResult> {
        let output = self
            .adb_base()
            .arg("shell")
            .arg(remote_command)
            .output()
            .map_err(|error| AppError::Device(format!("无法启动 adb：{error}")))?;
        let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
        text.push_str(&String::from_utf8_lossy(&output.stderr));
        let status = output.status.code().unwrap_or(-1);
        if !output.status.success() {
            return Err(AppError::Device(text.trim().to_string()));
        }
        Ok(CommandResult {
            output: text,
            status,
        })
    }

    pub(crate) fn ssh_session(&self) -> AppResult<Session> {
        let host = self
            .profile
            .host
            .as_deref()
            .ok_or_else(|| AppError::InvalidProfile("缺少 SSH 主机".into()))?;
        let port = self.profile.port.unwrap_or(22);
        let username = self.profile.username.as_deref().unwrap_or("root");
        let tcp = TcpStream::connect((host, port))
            .map_err(|error| AppError::Device(format!("无法连接 {host}:{port}：{error}")))?;
        tcp.set_read_timeout(Some(std::time::Duration::from_secs(30)))?;
        tcp.set_write_timeout(Some(std::time::Duration::from_secs(30)))?;
        let mut session = Session::new()?;
        session.set_tcp_stream(tcp);
        session.handshake()?;
        if let Some(password) = &self.profile.password {
            session.userauth_password(username, password)?;
        } else {
            session.userauth_agent(username).map_err(|error| {
                AppError::Device(format!("SSH Agent 认证失败；请提供密码或加载私钥：{error}"))
            })?;
        }
        if !session.authenticated() {
            return Err(AppError::Device("SSH 认证失败".into()));
        }
        Ok(session)
    }

    fn ssh_exec(&self, remote_command: &str) -> AppResult<CommandResult> {
        let session = self.ssh_session()?;
        let (mut stdout, stderr, status) = ssh_command_output(&session, remote_command)?;
        stdout.extend_from_slice(&stderr);
        let output = String::from_utf8_lossy(&stdout).into_owned();
        if status != 0 {
            return Err(AppError::Device(output.trim().to_string()));
        }
        Ok(CommandResult { output, status })
    }

    pub fn list_dir(&self, path: &str) -> AppResult<Vec<RemoteFile>> {
        let script = list_dir_script(path);
        let raw = match self.profile.transport {
            TransportKind::Adb => self.adb_shell_bytes(&script)?,
            TransportKind::Ssh => self.ssh_shell_bytes(&script)?,
        };
        parse_dir_listing(path, &raw)
    }

    fn adb_shell_bytes(&self, remote_command: &str) -> AppResult<Vec<u8>> {
        let output = self.adb_base().arg("shell").arg(remote_command).output()?;
        if !output.status.success() {
            return Err(AppError::Device(
                String::from_utf8_lossy(&output.stderr).trim().into(),
            ));
        }
        Ok(output.stdout)
    }

    fn ssh_shell_bytes(&self, remote_command: &str) -> AppResult<Vec<u8>> {
        let session = self.ssh_session()?;
        ssh_shell_bytes(&session, remote_command)
    }

    pub fn read_file(&self, path: &str) -> AppResult<Vec<u8>> {
        match self.profile.transport {
            TransportKind::Adb => self.adb_shell_bytes(&format!("cat {}", shell_quote(path))),
            TransportKind::Ssh => {
                let session = self.ssh_session()?;
                ssh_shell_bytes(&session, &format!("cat {}", shell_quote(path)))
            }
        }
    }

    pub fn write_file(&self, path: &str, contents: &[u8]) -> AppResult<()> {
        match self.profile.transport {
            TransportKind::Adb => {
                let mut temporary = tempfile::NamedTempFile::new()?;
                temporary.write_all(contents)?;
                temporary.flush()?;
                let output = self
                    .adb_base()
                    .arg("push")
                    .arg(temporary.path())
                    .arg(path)
                    .output()?;
                if !output.status.success() {
                    return Err(AppError::Device(
                        String::from_utf8_lossy(&output.stderr).trim().into(),
                    ));
                }
                Ok(())
            }
            TransportKind::Ssh => {
                let session = self.ssh_session()?;
                let mut source = contents;
                ssh_write_from_reader(&session, path, &mut source)
            }
        }
    }

    pub fn create_dir(&self, path: &str) -> AppResult<()> {
        self.exec(&format!("mkdir -p {}", shell_quote(path)))?;
        Ok(())
    }

    pub fn remove_paths(&self, paths: &[String]) -> AppResult<()> {
        if paths.is_empty() {
            return Ok(());
        }
        let args = paths
            .iter()
            .map(|path| shell_quote(path))
            .collect::<Vec<_>>()
            .join(" ");
        self.exec(&format!("rm -rf {args}"))?;
        Ok(())
    }

    pub fn rename(&self, source: &str, destination: &str) -> AppResult<()> {
        self.exec(&format!(
            "mv {} {}",
            shell_quote(source),
            shell_quote(destination)
        ))?;
        Ok(())
    }

    pub fn upload_paths(&self, local_paths: &[PathBuf], remote_dir: &str) -> AppResult<()> {
        match self.profile.transport {
            TransportKind::Adb => {
                self.create_dir(remote_dir)?;
                for local in local_paths {
                    let mut command = self.adb_base();
                    let output = command.arg("push").arg(local).arg(remote_dir).output()?;
                    if !output.status.success() {
                        return Err(AppError::Device(
                            String::from_utf8_lossy(&output.stderr).trim().into(),
                        ));
                    }
                }
                Ok(())
            }
            TransportKind::Ssh => {
                let session = self.ssh_session()?;
                ssh_shell_bytes(&session, &format!("mkdir -p {}", shell_quote(remote_dir)))?;
                for local in local_paths {
                    let name = local
                        .file_name()
                        .and_then(|name| name.to_str())
                        .ok_or_else(|| AppError::Other("本地路径没有有效文件名".into()))?;
                    upload_ssh_path(&session, local, &remote_join(remote_dir, name))?;
                }
                Ok(())
            }
        }
    }

    pub fn upload_directory_contents(&self, local_dir: &Path, remote_dir: &str) -> AppResult<()> {
        match self.profile.transport {
            TransportKind::Adb => {
                self.create_dir(remote_dir)?;
                let source = local_dir.join(".");
                let output = self
                    .adb_base()
                    .arg("push")
                    .arg(source)
                    .arg(remote_dir)
                    .output()?;
                if !output.status.success() {
                    return Err(AppError::Device(
                        String::from_utf8_lossy(&output.stderr).trim().into(),
                    ));
                }
                Ok(())
            }
            TransportKind::Ssh => {
                let session = self.ssh_session()?;
                ssh_shell_bytes(&session, &format!("mkdir -p {}", shell_quote(remote_dir)))?;
                for item in fs::read_dir(local_dir)? {
                    let item = item?;
                    let name = item
                        .file_name()
                        .to_str()
                        .ok_or_else(|| AppError::Other("本地路径没有有效文件名".into()))?
                        .to_string();
                    upload_ssh_path(&session, &item.path(), &remote_join(remote_dir, &name))?;
                }
                Ok(())
            }
        }
    }

    pub fn download_paths(&self, remote_paths: &[String], local_dir: &Path) -> AppResult<()> {
        fs::create_dir_all(local_dir)?;
        match self.profile.transport {
            TransportKind::Adb => {
                for remote in remote_paths {
                    let output = self
                        .adb_base()
                        .arg("pull")
                        .arg(remote)
                        .arg(local_dir)
                        .output()?;
                    if !output.status.success() {
                        return Err(AppError::Device(
                            String::from_utf8_lossy(&output.stderr).trim().into(),
                        ));
                    }
                }
                Ok(())
            }
            TransportKind::Ssh => {
                let session = self.ssh_session()?;
                for remote in remote_paths {
                    let name = remote
                        .trim_end_matches('/')
                        .rsplit('/')
                        .next()
                        .filter(|name| !name.is_empty())
                        .ok_or_else(|| AppError::Other("远程路径没有文件名".into()))?;
                    download_ssh_path(&session, remote, &local_dir.join(name))?;
                }
                Ok(())
            }
        }
    }
}

fn resolve_adb_program() -> PathBuf {
    if let Some(configured) = std::env::var_os("PENMANAGER_ADB") {
        return PathBuf::from(configured);
    }
    if let Ok(executable) = std::env::current_exe()
        && let Some(directory) = executable.parent()
    {
        for name in ["adb", "adb.exe"] {
            let candidate = directory.join(name);
            if candidate.is_file() {
                return candidate;
            }
        }
    }
    PathBuf::from("adb")
}

fn resolve_adb_serial(requested: Option<&str>) -> AppResult<String> {
    if let Some(serial) = requested.filter(|value| !value.is_empty()) {
        return Ok(serial.to_string());
    }
    let output = Command::new("adb")
        .arg("devices")
        .output()
        .map_err(|error| AppError::Device(format!("无法启动 adb：{error}")))?;
    let text = String::from_utf8_lossy(&output.stdout);
    let online = text
        .lines()
        .skip(1)
        .filter_map(|line| {
            let (serial, state) = line.split_once('\t')?;
            (state.trim() == "device").then(|| serial.to_string())
        })
        .collect::<Vec<_>>();
    match online.as_slice() {
        [serial] => Ok(serial.clone()),
        [] => Err(AppError::Device("没有发现已授权的 ADB 设备".into())),
        _ => Err(AppError::Device("发现多个 ADB 设备，请指定序列号".into())),
    }
}

fn ssh_command_output(
    session: &Session,
    remote_command: &str,
) -> AppResult<(Vec<u8>, Vec<u8>, i32)> {
    let mut channel = session.channel_session()?;
    channel.exec(&ssh_command(remote_command))?;
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    channel.read_to_end(&mut stdout)?;
    channel.stderr().read_to_end(&mut stderr)?;
    channel.wait_close()?;
    let status = channel.exit_status()?;
    Ok((stdout, stderr, status))
}

fn ssh_shell_bytes(session: &Session, remote_command: &str) -> AppResult<Vec<u8>> {
    let (stdout, stderr, status) = ssh_command_output(session, remote_command)?;
    if status != 0 {
        let message = if stderr.is_empty() { &stdout } else { &stderr };
        let message = String::from_utf8_lossy(message);
        return Err(AppError::Device(if message.trim().is_empty() {
            format!("SSH 命令退出状态：{status}")
        } else {
            message.trim().to_string()
        }));
    }
    Ok(stdout)
}

fn ssh_write_from_reader<R: Read>(
    session: &Session,
    remote: &str,
    source: &mut R,
) -> AppResult<()> {
    let mut channel = session.channel_session()?;
    channel.exec(&ssh_command(&format!("cat > {}", shell_quote(remote))))?;
    std::io::copy(source, &mut channel)?;
    channel.flush()?;
    channel.send_eof()?;
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    channel.read_to_end(&mut stdout)?;
    channel.stderr().read_to_end(&mut stderr)?;
    channel.wait_close()?;
    let status = channel.exit_status()?;
    if status != 0 {
        let message = if stderr.is_empty() { &stdout } else { &stderr };
        return Err(AppError::Device(
            String::from_utf8_lossy(message).trim().to_string(),
        ));
    }
    Ok(())
}

fn ssh_copy_file(session: &Session, remote: &str, local: &Path) -> AppResult<()> {
    let mut channel = session.channel_session()?;
    channel.exec(&ssh_command(&format!("cat {}", shell_quote(remote))))?;
    let mut destination = fs::File::create(local)?;
    std::io::copy(&mut channel, &mut destination)?;
    destination.flush()?;
    let mut stderr = Vec::new();
    channel.stderr().read_to_end(&mut stderr)?;
    channel.wait_close()?;
    let status = channel.exit_status()?;
    if status != 0 {
        let _ = fs::remove_file(local);
        return Err(AppError::Device(
            String::from_utf8_lossy(&stderr).trim().to_string(),
        ));
    }
    Ok(())
}

fn list_dir_script(path: &str) -> String {
    let quoted = shell_quote(path);
    format!(
        "p={quoted}; for f in \"$p\"/.[!.]* \"$p\"/..?* \"$p\"/*; do \
         [ -e \"$f\" ] || [ -L \"$f\" ] || continue; \
         n=${{f##*/}}; t=file; [ -d \"$f\" ] && t=directory; [ -L \"$f\" ] && t=link; \
         s=$(stat -c %s \"$f\" 2>/dev/null || echo 0); \
         m=$(stat -c %Y \"$f\" 2>/dev/null || echo 0); \
         o=$(stat -c %A \"$f\" 2>/dev/null || echo ''); \
         printf '%s\\034%s\\034%s\\034%s\\034%s\\000' \"$t\" \"$n\" \"$s\" \"$m\" \"$o\"; done"
    )
}

fn parse_dir_listing(parent: &str, raw: &[u8]) -> AppResult<Vec<RemoteFile>> {
    let mut files = Vec::new();
    for record in raw
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
    {
        let text = String::from_utf8_lossy(record);
        let fields: Vec<&str> = text.split(FIELD_SEPARATOR).collect();
        if fields.len() != 5 {
            continue;
        }
        files.push(RemoteFile {
            kind: fields[0].to_string(),
            name: fields[1].to_string(),
            path: remote_join(parent, fields[1]),
            size: fields[2].parse().unwrap_or(0),
            modified: fields[3].parse().unwrap_or(0),
            mode: fields[4].to_string(),
        });
    }
    Ok(files)
}

fn ssh_list_dir(session: &Session, path: &str) -> AppResult<Vec<RemoteFile>> {
    let raw = ssh_shell_bytes(session, &list_dir_script(path))?;
    parse_dir_listing(path, &raw)
}

fn upload_ssh_path(session: &Session, local: &Path, remote: &str) -> AppResult<()> {
    if local.is_dir() {
        ssh_shell_bytes(session, &format!("mkdir -p {}", shell_quote(remote)))?;
        for entry in fs::read_dir(local)? {
            let entry = entry?;
            let name = entry
                .file_name()
                .to_str()
                .ok_or_else(|| AppError::Other("本地路径没有有效文件名".into()))?
                .to_string();
            upload_ssh_path(session, &entry.path(), &remote_join(remote, &name))?;
        }
    } else {
        let mut source = fs::File::open(local)?;
        ssh_write_from_reader(session, remote, &mut source)?;
    }
    Ok(())
}

fn download_ssh_path(session: &Session, remote: &str, local: &Path) -> AppResult<()> {
    let kind = ssh_shell_bytes(
        session,
        &format!(
            "if [ -L {path} ]; then printf l; elif [ -d {path} ]; then printf d; \
             elif [ -e {path} ]; then printf f; else printf 'path not found' >&2; exit 1; fi",
            path = shell_quote(remote)
        ),
    )?;
    if kind == b"d" {
        fs::create_dir_all(local)?;
        for child in ssh_list_dir(session, remote)? {
            download_ssh_path(session, &child.path, &local.join(&child.name))?;
        }
    } else {
        ssh_copy_file(session, remote, local)?;
    }
    Ok(())
}

pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub(crate) fn ssh_path_export() -> String {
    format!("PATH={SSH_STANDARD_PATH}${{PATH:+:$PATH}}; export PATH;")
}

fn ssh_command(remote_command: &str) -> String {
    format!("{} {remote_command}", ssh_path_export())
}

pub fn remote_join(parent: &str, child: &str) -> String {
    if parent == "/" {
        format!("/{child}")
    } else {
        format!("{}/{child}", parent.trim_end_matches('/'))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_shell_values() {
        assert_eq!(shell_quote("plain"), "'plain'");
        assert_eq!(shell_quote("a'b"), "'a'\\''b'");
    }

    #[test]
    fn joins_remote_paths() {
        assert_eq!(remote_join("/", "tmp"), "/tmp");
        assert_eq!(remote_join("/userdisk/", "Music"), "/userdisk/Music");
    }

    #[test]
    fn ssh_commands_include_standard_system_paths() {
        let command = ssh_command("mkdir -p /tmp/example");
        assert!(
            command
                .starts_with("PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
        );
        assert!(command.ends_with("export PATH; mkdir -p /tmp/example"));
    }

    #[cfg(unix)]
    #[test]
    fn sends_adb_shell_script_as_one_argument() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let fake_adb = directory.path().join("adb");
        fs::write(
            &fake_adb,
            "#!/bin/sh\n[ \"$1\" = shell ] || exit 2\nshift\nexec /bin/sh -c \"$1\"\n",
        )
        .unwrap();
        fs::set_permissions(&fake_adb, fs::Permissions::from_mode(0o755)).unwrap();
        let connection = DeviceConnection {
            profile: ConnectionProfile {
                id: "test".into(),
                name: "Test".into(),
                transport: TransportKind::Adb,
                serial: None,
                host: None,
                port: None,
                username: None,
                password: None,
            },
            adb_path: Some(fake_adb),
        };
        let result = connection
            .exec("value='folder name'; printf '%s' \"$value\"")
            .unwrap();
        assert_eq!(result.output, "folder name");

        let remote = directory.path().join("remote root");
        fs::create_dir_all(remote.join("nested folder")).unwrap();
        fs::write(remote.join("file.txt"), b"content").unwrap();
        let files = connection.list_dir(remote.to_str().unwrap()).unwrap();
        assert!(
            files
                .iter()
                .any(|file| { file.name == "nested folder" && file.kind == "directory" })
        );
        assert!(
            files
                .iter()
                .any(|file| file.name == "file.txt" && file.kind == "file")
        );
    }
}
