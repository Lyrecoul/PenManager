use crate::error::{AppError, AppResult};
use crate::models::{PenModsSource, PenModsUpdate};
use crate::plugins;
use crate::transport::{DeviceConnection, shell_quote};
use reqwest::header::{ACCEPT, AUTHORIZATION, USER_AGENT};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tempfile::Builder;
use zip::ZipArchive;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct MarketIndex {
    #[serde(alias = "schemaVersion")]
    pub schema_version: u32,
    pub name: Option<String>,
    pub plugins: Vec<MarketPlugin>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct MarketPlugin {
    pub id: String,
    pub name: String,
    pub summary: String,
    pub author: Option<String>,
    pub repository: Option<String>,
    pub icon: Option<String>,
    pub versions: Vec<MarketVersion>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct MarketVersion {
    pub version: String,
    pub url: String,
    pub sha256: String,
    pub devices: Option<Vec<String>>,
    #[serde(alias = "minPenmods")]
    pub min_penmods: Option<String>,
    pub native: Option<bool>,
    pub roots: Option<Vec<String>>,
}

impl MarketIndex {
    pub fn validate(&self) -> AppResult<()> {
        if self.schema_version != 1 {
            return Err(AppError::Network(format!(
                "不支持的市场索引版本：{}",
                self.schema_version
            )));
        }
        let mut ids = HashSet::new();
        for plugin in &self.plugins {
            if plugin.id.trim().is_empty() || plugin.name.trim().is_empty() {
                return Err(AppError::Network("市场索引包含无效插件".into()));
            }
            if !ids.insert(&plugin.id) {
                return Err(AppError::Network(format!(
                    "市场索引中的插件 ID 重复：{}",
                    plugin.id
                )));
            }
            if plugin.versions.is_empty() {
                return Err(AppError::Network(format!(
                    "插件没有可用版本：{}",
                    plugin.id
                )));
            }
        }
        Ok(())
    }
}

pub async fn load_market(url: &str) -> AppResult<MarketIndex> {
    ensure_https_or_localhost(url)?;
    let response = reqwest::Client::new()
        .get(url)
        .header(USER_AGENT, "PenManager/0.1.1")
        .send()
        .await
        .map_err(|error| AppError::Network(error.to_string()))?
        .error_for_status()
        .map_err(|error| AppError::Network(error.to_string()))?;
    let index = response
        .json::<MarketIndex>()
        .await
        .map_err(|error| AppError::Network(format!("无法解析市场索引：{error}")))?;
    index.validate()?;
    Ok(index)
}

pub async fn install_market_plugin(
    connection: &DeviceConnection,
    url: &str,
    expected_sha256: &str,
    roots: Option<&[String]>,
    enable: bool,
) -> AppResult<Vec<String>> {
    ensure_https_or_localhost(url)?;
    if expected_sha256.len() != 64
        || !expected_sha256
            .chars()
            .all(|value| value.is_ascii_hexdigit())
    {
        return Err(AppError::Network("市场条目缺少有效的 SHA-256".into()));
    }
    let bytes = download(url, None).await?;
    verify_sha256(&bytes, expected_sha256)?;
    let mut archive = Builder::new().suffix(".zip").tempfile()?;
    std::io::Write::write_all(&mut archive, &bytes)?;
    plugins::install_archive(connection, archive.path(), None, roots, enable)
}

pub async fn check_penmods_update(source: &PenModsSource) -> AppResult<PenModsUpdate> {
    validate_repository(&source.repository)?;
    let client = reqwest::Client::new();
    if source.channel == "release" {
        let url = format!(
            "https://api.github.com/repos/{}/releases/latest",
            source.repository
        );
        let value = github_get(&client, &url, source.token.as_deref()).await?;
        let assets = value["assets"]
            .as_array()
            .ok_or_else(|| AppError::Network("Release 没有构建产物".into()))?;
        let asset = assets
            .iter()
            .find(|asset| {
                let name = asset["name"].as_str().unwrap_or_default();
                (name.contains(&source.platform)
                    || !assets.iter().any(|item| {
                        item["name"]
                            .as_str()
                            .unwrap_or_default()
                            .contains(&source.platform)
                    }))
                    && (name.ends_with(".zip") || name.ends_with(".so"))
            })
            .ok_or_else(|| AppError::Network(format!("Release 中没有 {} 构建", source.platform)))?;
        return Ok(PenModsUpdate {
            version: value["tag_name"].as_str().unwrap_or("latest").to_string(),
            commit: value["target_commitish"].as_str().map(str::to_string),
            published_at: value["published_at"].as_str().map(str::to_string),
            download_url: asset["browser_download_url"]
                .as_str()
                .ok_or_else(|| AppError::Network("Release 产物缺少下载地址".into()))?
                .to_string(),
        });
    }

    let runs_url = format!(
        "https://api.github.com/repos/{}/actions/workflows/{}/runs?branch={}&status=success&per_page=1",
        source.repository, source.workflow, source.branch
    );
    let runs = github_get(&client, &runs_url, source.token.as_deref()).await?;
    let run = runs["workflow_runs"]
        .as_array()
        .and_then(|runs| runs.first())
        .ok_or_else(|| AppError::Network("没有找到成功的 CI 构建".into()))?;
    let run_id = run["id"]
        .as_u64()
        .ok_or_else(|| AppError::Network("CI 构建 ID 无效".into()))?;
    let artifacts_url = format!(
        "https://api.github.com/repos/{}/actions/runs/{run_id}/artifacts",
        source.repository
    );
    let artifacts = github_get(&client, &artifacts_url, source.token.as_deref()).await?;
    let artifact = artifacts["artifacts"]
        .as_array()
        .and_then(|items| {
            items.iter().find(|item| {
                item["name"]
                    .as_str()
                    .unwrap_or_default()
                    .contains(&source.platform)
            })
        })
        .ok_or_else(|| AppError::Network(format!("CI 中没有 {} 构建产物", source.platform)))?;
    if artifact["expired"].as_bool().unwrap_or(false) {
        return Err(AppError::Network("最新 CI 构建产物已过期".into()));
    }
    Ok(PenModsUpdate {
        version: format!("CI #{}", run["run_number"].as_u64().unwrap_or(run_id)),
        commit: run["head_sha"].as_str().map(str::to_string),
        published_at: run["updated_at"].as_str().map(str::to_string),
        download_url: artifact["archive_download_url"]
            .as_str()
            .ok_or_else(|| AppError::Network("CI 产物缺少下载地址".into()))?
            .to_string(),
    })
}

pub async fn install_penmods_update(
    connection: &DeviceConnection,
    source: &PenModsSource,
) -> AppResult<()> {
    let update = check_penmods_update(source).await?;
    let bytes = download(&update.download_url, source.token.as_deref()).await?;
    let library = extract_penmods_library(&bytes)?;
    validate_aarch64_elf(&library)?;
    let local = tempfile::tempdir()?;
    let local_library = local.path().join("libPenMods.so.penmanager-new");
    fs::write(&local_library, &library)?;
    connection.upload_paths(std::slice::from_ref(&local_library), "/userdata/PenMods")?;

    let remote_new = "/userdata/PenMods/libPenMods.so.penmanager-new";
    let remote_target = "/userdata/PenMods/libPenMods.so";
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let backup = format!("/userdata/PenMods/libPenMods.so.backup-{timestamp}");
    let command = format!(
        "chmod 755 {new}; if [ -e {target} ]; then mv {target} {backup}; fi; mv {new} {target}",
        new = shell_quote(remote_new),
        target = shell_quote(remote_target),
        backup = shell_quote(&backup),
    );
    if let Err(error) = connection.exec(&command) {
        let _ = connection.exec(&format!(
            "rm -f {new}; if [ ! -e {target} ] && [ -e {backup} ]; then mv {backup} {target}; fi",
            new = shell_quote(remote_new),
            target = shell_quote(remote_target),
            backup = shell_quote(&backup),
        ));
        return Err(error);
    }
    Ok(())
}

async fn github_get(
    client: &reqwest::Client,
    url: &str,
    token: Option<&str>,
) -> AppResult<serde_json::Value> {
    let mut request = client
        .get(url)
        .header(USER_AGENT, "PenManager/0.1.1")
        .header(ACCEPT, "application/vnd.github+json");
    if let Some(token) = token.filter(|value| !value.is_empty()) {
        request = request.header(AUTHORIZATION, format!("Bearer {token}"));
    }
    request
        .send()
        .await
        .map_err(|error| AppError::Network(error.to_string()))?
        .error_for_status()
        .map_err(|error| AppError::Network(error.to_string()))?
        .json()
        .await
        .map_err(|error| AppError::Network(error.to_string()))
}

async fn download(url: &str, token: Option<&str>) -> AppResult<Vec<u8>> {
    let mut request = reqwest::Client::new()
        .get(url)
        .header(USER_AGENT, "PenManager/0.1.1")
        .header(ACCEPT, "application/octet-stream");
    if let Some(token) = token.filter(|value| !value.is_empty()) {
        request = request.header(AUTHORIZATION, format!("Bearer {token}"));
    }
    Ok(request
        .send()
        .await
        .map_err(|error| AppError::Network(error.to_string()))?
        .error_for_status()
        .map_err(|error| AppError::Network(error.to_string()))?
        .bytes()
        .await
        .map_err(|error| AppError::Network(error.to_string()))?
        .to_vec())
}

fn extract_penmods_library(bytes: &[u8]) -> AppResult<Vec<u8>> {
    if bytes.starts_with(b"\x7fELF") {
        return Ok(bytes.to_vec());
    }
    if !bytes.starts_with(b"PK") {
        return Err(AppError::Archive(
            "PenMods 构建既不是 ELF，也不是 ZIP".into(),
        ));
    }
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = ZipArchive::new(cursor)?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        if Path::new(entry.name())
            .file_name()
            .is_some_and(|name| name == "libPenMods.so")
        {
            let mut library = Vec::new();
            entry.read_to_end(&mut library)?;
            return Ok(library);
        }
    }
    Err(AppError::Archive("构建产物中没有 libPenMods.so".into()))
}

fn validate_aarch64_elf(bytes: &[u8]) -> AppResult<()> {
    if bytes.len() < 20 || &bytes[..4] != b"\x7fELF" || bytes[4] != 2 || bytes[5] != 1 {
        return Err(AppError::Archive("libPenMods.so 不是 64 位小端 ELF".into()));
    }
    let machine = u16::from_le_bytes([bytes[18], bytes[19]]);
    if machine != 183 {
        return Err(AppError::Archive(format!(
            "libPenMods.so 架构错误（ELF machine {machine}）"
        )));
    }
    Ok(())
}

fn verify_sha256(bytes: &[u8], expected: &str) -> AppResult<()> {
    let actual = hex::encode(Sha256::digest(bytes));
    if !actual.eq_ignore_ascii_case(expected) {
        return Err(AppError::Network(format!(
            "SHA-256 不匹配：期望 {expected}，实际 {actual}"
        )));
    }
    Ok(())
}

fn ensure_https_or_localhost(url: &str) -> AppResult<()> {
    if url.starts_with("https://")
        || url.starts_with("http://127.0.0.1")
        || url.starts_with("http://localhost")
    {
        Ok(())
    } else {
        Err(AppError::Network(
            "仅允许 HTTPS 市场源（本机开发地址除外）".into(),
        ))
    }
}

fn validate_repository(repository: &str) -> AppResult<()> {
    let parts = repository.split('/').collect::<Vec<_>>();
    if parts.len() != 2
        || parts.iter().any(|part| {
            part.is_empty()
                || !part
                    .chars()
                    .all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_' | '.'))
        })
    {
        return Err(AppError::Network(
            "GitHub 仓库格式应为 owner/repository".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_insecure_market_url() {
        assert!(ensure_https_or_localhost("http://example.com/index.json").is_err());
        assert!(ensure_https_or_localhost("http://localhost:8000/index.json").is_ok());
    }

    #[test]
    fn validates_repository_names() {
        assert!(validate_repository("Lyrecoul/PenMods").is_ok());
        assert!(validate_repository("bad").is_err());
        assert!(validate_repository("owner/repo/extra").is_err());
    }
}
