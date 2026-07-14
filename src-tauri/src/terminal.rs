use crate::error::{AppError, AppResult};
use crate::models::TransportKind;
use crate::transport::{DeviceConnection, ssh_path_export};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::sync::Mutex;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub enum TerminalMessage {
    Input(String),
    Resize(u32, u32),
    Close,
}

#[derive(Default)]
pub struct TerminalManager {
    sessions: Mutex<HashMap<String, Sender<TerminalMessage>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput {
    session_id: String,
    data: String,
    closed: bool,
}

impl TerminalManager {
    pub fn start(
        &self,
        app: AppHandle,
        session_id: String,
        connection: DeviceConnection,
        columns: u32,
        rows: u32,
    ) -> AppResult<()> {
        self.close(&session_id)?;
        let (sender, receiver) = mpsc::channel();
        self.sessions
            .lock()
            .map_err(|_| AppError::Other("终端状态锁已损坏".into()))?
            .insert(session_id.clone(), sender);
        thread::spawn(move || {
            let result = match connection.kind() {
                TransportKind::Adb => run_adb_terminal(&app, &session_id, &connection, receiver),
                TransportKind::Ssh => {
                    run_ssh_terminal(&app, &session_id, &connection, receiver, columns, rows)
                }
            };
            if let Err(error) = result {
                emit_output(
                    &app,
                    &session_id,
                    &format!("\r\n\x1b[31m{error}\x1b[0m\r\n"),
                    false,
                );
            }
            emit_output(&app, &session_id, "", true);
        });
        Ok(())
    }

    pub fn send(&self, session_id: &str, message: TerminalMessage) -> AppResult<()> {
        let sender = self
            .sessions
            .lock()
            .map_err(|_| AppError::Other("终端状态锁已损坏".into()))?
            .get(session_id)
            .cloned()
            .ok_or_else(|| AppError::Device("终端会话不存在".into()))?;
        sender
            .send(message)
            .map_err(|_| AppError::Device("终端会话已关闭".into()))
    }

    pub fn close(&self, session_id: &str) -> AppResult<()> {
        if let Some(sender) = self
            .sessions
            .lock()
            .map_err(|_| AppError::Other("终端状态锁已损坏".into()))?
            .remove(session_id)
        {
            let _ = sender.send(TerminalMessage::Close);
        }
        Ok(())
    }

    pub fn close_all(&self) -> AppResult<()> {
        let sessions = std::mem::take(
            &mut *self
                .sessions
                .lock()
                .map_err(|_| AppError::Other("终端状态锁已损坏".into()))?,
        );
        for (_, sender) in sessions {
            let _ = sender.send(TerminalMessage::Close);
        }
        Ok(())
    }
}

fn run_adb_terminal(
    app: &AppHandle,
    session_id: &str,
    connection: &DeviceConnection,
    receiver: Receiver<TerminalMessage>,
) -> AppResult<()> {
    let mut child = connection
        .adb_base()
        .arg("shell")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| AppError::Device(format!("无法启动 adb shell：{error}")))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::Device("无法打开终端输入".into()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Device("无法打开终端输出".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Device("无法打开终端错误输出".into()))?;
    spawn_reader(app.clone(), session_id.to_string(), stdout);
    spawn_reader(app.clone(), session_id.to_string(), stderr);

    loop {
        if child.try_wait()?.is_some() {
            break;
        }
        match receiver.recv_timeout(Duration::from_millis(30)) {
            Ok(TerminalMessage::Input(data)) => {
                stdin.write_all(data.as_bytes())?;
                stdin.flush()?;
            }
            Ok(TerminalMessage::Resize(_, _)) => {}
            Ok(TerminalMessage::Close) | Err(RecvTimeoutError::Disconnected) => {
                let _ = child.kill();
                break;
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
    }
    Ok(())
}

fn run_ssh_terminal(
    app: &AppHandle,
    session_id: &str,
    connection: &DeviceConnection,
    receiver: Receiver<TerminalMessage>,
    columns: u32,
    rows: u32,
) -> AppResult<()> {
    let session = connection.ssh_session()?;
    let mut channel = session.channel_session()?;
    channel.request_pty("xterm-256color", None, Some((columns, rows, 0, 0)))?;
    channel.shell()?;
    channel.write_all(format!("{}\n", ssh_path_export()).as_bytes())?;
    channel.flush()?;
    session.set_blocking(false);
    let mut buffer = [0_u8; 8192];

    loop {
        match channel.read(&mut buffer) {
            Ok(0) => {}
            Ok(size) => emit_output(
                app,
                session_id,
                &String::from_utf8_lossy(&buffer[..size]),
                false,
            ),
            Err(error) if error.kind() == ErrorKind::WouldBlock => {}
            Err(error) => return Err(error.into()),
        }
        match channel.stderr().read(&mut buffer) {
            Ok(0) => {}
            Ok(size) => emit_output(
                app,
                session_id,
                &String::from_utf8_lossy(&buffer[..size]),
                false,
            ),
            Err(error) if error.kind() == ErrorKind::WouldBlock => {}
            Err(error) => return Err(error.into()),
        }
        if channel.eof() {
            break;
        }
        match receiver.recv_timeout(Duration::from_millis(15)) {
            Ok(TerminalMessage::Input(data)) => {
                channel.write_all(data.as_bytes())?;
                channel.flush()?;
            }
            Ok(TerminalMessage::Resize(columns, rows)) => {
                channel.request_pty_size(columns, rows, None, None)?;
            }
            Ok(TerminalMessage::Close) | Err(RecvTimeoutError::Disconnected) => {
                let _ = channel.close();
                break;
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
    }
    Ok(())
}

fn spawn_reader<R>(app: AppHandle, session_id: String, mut reader: R)
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(size) => emit_output(
                    &app,
                    &session_id,
                    &String::from_utf8_lossy(&buffer[..size]),
                    false,
                ),
            }
        }
    });
}

fn emit_output(app: &AppHandle, session_id: &str, data: &str, closed: bool) {
    let _ = app.emit(
        "terminal-output",
        TerminalOutput {
            session_id: session_id.to_string(),
            data: data.to_string(),
            closed,
        },
    );
}
