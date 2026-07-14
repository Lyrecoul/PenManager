use crate::error::{AppError, AppResult};
use crate::models::{ArchivePlugin, PluginInfo, PluginMetadata};
use crate::transport::{DeviceConnection, shell_quote};
use std::collections::HashSet;
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tempfile::TempDir;
use uuid::Uuid;
use zip::ZipArchive;

const PLUGIN_DIR: &str = "/userdisk/PenMods/plugins";
const MAX_ENTRIES: usize = 10_000;
const MAX_UNCOMPRESSED_SIZE: u64 = 256 * 1024 * 1024;
const MAX_SINGLE_FILE_SIZE: u64 = 128 * 1024 * 1024;

#[derive(Clone, Debug)]
struct ArchiveCandidate {
    root: PathBuf,
    install_dir: String,
    metadata: PluginMetadata,
    health: String,
}

pub fn list_plugins(
    connection: &DeviceConnection,
    changed: &HashSet<String>,
) -> AppResult<Vec<PluginInfo>> {
    connection.create_dir(PLUGIN_DIR)?;
    let process_snapshot = connection.exec(
        "set -- $(pidof YoudaoDictPen 2>/dev/null); pid=$1; \
         printf '%s\\000' \"$pid\"; \
         if [ -n \"$pid\" ]; then cat /proc/$pid/maps 2>/dev/null || true; fi",
    )?;
    let (process_id, maps) = process_snapshot.output.split_once('\0').unwrap_or(("", ""));
    let snapshot_script = format!(
        "root={root}; for d in \"$root\"/*; do \
         [ -d \"$d\" ] || continue; \
         printf '%s\\034' \"$d\"; \
         if [ -e \"$d/.disabled\" ]; then printf '1\\034'; else printf '0\\034'; fi; \
         if [ -e \"$d/.loading\" ]; then printf '1\\034'; else printf '0\\034'; fi; \
         cat \"$d/metadata.json\" 2>/dev/null || true; \
         printf '\\000'; done",
        root = shell_quote(PLUGIN_DIR),
    );
    let snapshot = connection.exec(&snapshot_script)?.output;
    let mut result = Vec::new();
    for record in snapshot.split('\0').filter(|record| !record.is_empty()) {
        let fields = record.splitn(4, '\u{1c}').collect::<Vec<_>>();
        if fields.len() != 4 {
            continue;
        }
        let path = fields[0].to_string();
        let fallback_id = Path::new(&path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("invalid-plugin");
        let disabled = fields[1] == "1";
        let loading = fields[2] == "1";
        let Ok(metadata) = serde_json::from_str::<PluginMetadata>(fields[3]) else {
            result.push(invalid_remote_plugin(&path, fallback_id));
            continue;
        };
        if metadata.id.trim().is_empty() {
            result.push(invalid_remote_plugin(&path, fallback_id));
            continue;
        }
        let native = metadata
            .main_so
            .as_deref()
            .is_some_and(|value| !value.is_empty());
        let loaded = if process_id.is_empty() {
            Some(false)
        } else if native {
            Some(maps.contains(&path))
        } else {
            Some(!disabled)
        };
        result.push(PluginInfo {
            id: metadata.id.clone(),
            name: if metadata.name.is_empty() {
                metadata.id.clone()
            } else {
                metadata.name
            },
            version: metadata.version,
            author: metadata.author,
            description: metadata.description,
            path,
            enabled: !disabled,
            loaded,
            native,
            health: if loading {
                "loading-marker".into()
            } else {
                "ok".into()
            },
            restart_required: changed.contains(&metadata.id),
        });
    }
    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(result)
}

pub fn inspect_archive(path: &Path) -> AppResult<Vec<ArchivePlugin>> {
    let candidates = discover_archive(path)?;
    Ok(candidates
        .into_iter()
        .map(|candidate| {
            let metadata = candidate.metadata;
            let root = display_archive_root(&candidate.root);
            ArchivePlugin {
                plugin: PluginInfo {
                    id: metadata.id.clone(),
                    name: if metadata.name.is_empty() {
                        metadata.id.clone()
                    } else {
                        metadata.name
                    },
                    version: metadata.version,
                    author: metadata.author,
                    description: metadata.description,
                    path: String::new(),
                    enabled: false,
                    loaded: None,
                    native: metadata
                        .main_so
                        .as_deref()
                        .is_some_and(|value| !value.is_empty()),
                    health: candidate.health,
                    restart_required: true,
                },
                archive_root: root,
                selected: true,
            }
        })
        .collect())
}

pub fn install_archive(
    connection: &DeviceConnection,
    archive_path: &Path,
    selected_ids: Option<&HashSet<String>>,
    selected_roots: Option<&[String]>,
    enable: bool,
) -> AppResult<Vec<String>> {
    let candidates = discover_archive(archive_path)?;
    let root_filter = selected_roots.map(|roots| {
        roots
            .iter()
            .map(|root| normalize_root_string(root))
            .collect::<HashSet<_>>()
    });
    let selected = candidates
        .into_iter()
        .filter(|candidate| {
            selected_ids.is_none_or(|ids| ids.contains(&candidate.metadata.id))
                && root_filter
                    .as_ref()
                    .is_none_or(|roots| roots.contains(&normalize_path(&candidate.root)))
        })
        .collect::<Vec<_>>();
    if selected.is_empty() {
        return Err(AppError::Archive("没有选择可安装的插件".into()));
    }
    if let Some(candidate) = selected.iter().find(|candidate| candidate.health != "ok") {
        return Err(AppError::Archive(format!(
            "插件 {} 缺少 metadata.json 中声明的入口文件",
            candidate.metadata.id
        )));
    }
    ensure_unique_install_dirs(&selected)?;

    let extraction = extract_archive(archive_path)?;
    let transaction = Uuid::new_v4().to_string();
    let staging_root = format!("/userdisk/PenMods/.penmanager-staging/{transaction}");
    connection.create_dir(&staging_root)?;
    let mut staged = Vec::new();

    for candidate in &selected {
        validate_plugin_id(&candidate.metadata.id)?;
        let local_root = extraction.path().join(&candidate.root);
        if !enable {
            fs::write(local_root.join(".disabled"), [])?;
        } else {
            let _ = fs::remove_file(local_root.join(".disabled"));
        }
        let _ = fs::remove_file(local_root.join(".loading"));
        let target = format!("{PLUGIN_DIR}/{}", candidate.install_dir);
        if let Ok(raw) = connection.read_file(&format!("{target}/metadata.json"))
            && let Ok(installed_metadata) = serde_json::from_slice::<PluginMetadata>(&raw)
            && installed_metadata.id != candidate.metadata.id
        {
            let _ = connection.remove_paths(std::slice::from_ref(&staging_root));
            return Err(AppError::Archive(format!(
                "插件目录 {} 已被插件 {} 占用",
                candidate.install_dir, installed_metadata.id
            )));
        }
        let existing_path = match find_plugin_path_optional(connection, &candidate.metadata.id) {
            Ok(path) => path,
            Err(error) => {
                let _ = connection.remove_paths(std::slice::from_ref(&staging_root));
                return Err(error);
            }
        };
        let remote_stage = format!("{staging_root}/{}", candidate.install_dir);
        if let Err(error) = connection.upload_directory_contents(&local_root, &remote_stage) {
            let _ = connection.remove_paths(std::slice::from_ref(&staging_root));
            return Err(error);
        }
        staged.push((
            candidate.metadata.id.clone(),
            target,
            remote_stage,
            existing_path,
        ));
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let backup_root = format!("/userdisk/PenMods/.penmanager-backups/{timestamp}");
    connection.create_dir(&backup_root)?;
    let mut installed = Vec::new();
    let mut committed: Vec<(String, Vec<(String, String)>)> = Vec::new();
    for (id, target, remote_stage, existing_path) in &staged {
        let mut backups = vec![(
            target.clone(),
            format!("{backup_root}/{}", remote_file_name(target)?),
        )];
        if let Some(existing_path) = existing_path
            .as_deref()
            .filter(|existing_path| *existing_path != target)
        {
            backups.push((
                existing_path.to_string(),
                format!("{backup_root}/{}", remote_file_name(existing_path)?),
            ));
        }
        let backup_commands = backups
            .iter()
            .map(|(source, backup)| {
                format!(
                    "if [ -e {source} ]; then mv {source} {backup}; fi",
                    source = shell_quote(source),
                    backup = shell_quote(backup),
                )
            })
            .collect::<Vec<_>>()
            .join("; ");
        let command = format!(
            "{backup_commands}; mv {stage} {target}",
            stage = shell_quote(remote_stage),
            target = shell_quote(target),
        );
        if let Err(error) = connection.exec(&command) {
            let current_rollback = rollback_command(target, &backups);
            let _ = connection.exec(&current_rollback);
            for (committed_target, committed_backups) in committed.iter().rev() {
                let rollback = rollback_command(committed_target, committed_backups);
                let _ = connection.exec(&rollback);
            }
            let _ = connection.remove_paths(std::slice::from_ref(&staging_root));
            return Err(error);
        }
        committed.push((target.clone(), backups));
        installed.push(id.clone());
    }
    let _ = connection.remove_paths(&[staging_root]);
    Ok(installed)
}

pub fn set_enabled(connection: &DeviceConnection, id: &str, enabled: bool) -> AppResult<()> {
    validate_plugin_id(id)?;
    let plugin_path = find_plugin_path(connection, id)?;
    let marker = format!("{plugin_path}/.disabled");
    if enabled {
        connection.exec(&format!("rm -f {}", shell_quote(&marker)))?;
    } else {
        connection.exec(&format!("touch {}", shell_quote(&marker)))?;
    }
    Ok(())
}

pub fn remove_plugin(connection: &DeviceConnection, id: &str) -> AppResult<()> {
    validate_plugin_id(id)?;
    let source = find_plugin_path(connection, id)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let backup_dir = format!("/userdisk/PenMods/.penmanager-backups/{timestamp}");
    connection.create_dir(&backup_dir)?;
    connection.rename(&source, &format!("{backup_dir}/{id}"))?;
    Ok(())
}

fn find_plugin_path(connection: &DeviceConnection, id: &str) -> AppResult<String> {
    find_plugin_path_optional(connection, id)?
        .ok_or_else(|| AppError::Device(format!("插件不存在：{id}")))
}

fn find_plugin_path_optional(connection: &DeviceConnection, id: &str) -> AppResult<Option<String>> {
    for entry in connection.list_dir(PLUGIN_DIR)? {
        if entry.kind != "directory" || entry.name.starts_with('.') {
            continue;
        }
        let metadata_path = format!("{}/metadata.json", entry.path);
        let Ok(raw) = connection.read_file(&metadata_path) else {
            continue;
        };
        let Ok(metadata) = serde_json::from_slice::<PluginMetadata>(&raw) else {
            continue;
        };
        if metadata.id == id {
            return Ok(Some(entry.path));
        }
    }
    Ok(None)
}

fn discover_archive(path: &Path) -> AppResult<Vec<ArchiveCandidate>> {
    let file = fs::File::open(path).map_err(|error| AppError::Archive(error.to_string()))?;
    let mut archive = ZipArchive::new(file)?;
    if archive.len() > MAX_ENTRIES {
        return Err(AppError::Archive(format!(
            "文件数量超过限制（{MAX_ENTRIES}）"
        )));
    }
    let mut total_size = 0_u64;
    let mut paths = HashSet::new();
    let mut metadata_files = Vec::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index)?;
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| AppError::Archive(format!("包含不安全路径：{}", entry.name())))?
            .to_path_buf();
        validate_archive_path(&enclosed)?;
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(AppError::Archive(format!(
                "不允许符号链接：{}",
                entry.name()
            )));
        }
        if entry.size() > MAX_SINGLE_FILE_SIZE {
            return Err(AppError::Archive(format!("单个文件过大：{}", entry.name())));
        }
        total_size = total_size.saturating_add(entry.size());
        if total_size > MAX_UNCOMPRESSED_SIZE {
            return Err(AppError::Archive("解压后总大小超过 256 MiB".into()));
        }
        paths.insert(enclosed.clone());
        if !entry.is_dir()
            && enclosed
                .file_name()
                .is_some_and(|name| name == "metadata.json")
        {
            metadata_files.push((index, enclosed));
        }
    }
    if metadata_files.is_empty() {
        return Err(AppError::Archive("没有发现 metadata.json".into()));
    }

    let mut candidates = Vec::new();
    let mut ids = HashSet::new();
    for (index, metadata_path) in metadata_files {
        let mut entry = archive.by_index(index)?;
        if entry.size() > 1024 * 1024 {
            return Err(AppError::Archive(format!(
                "metadata.json 过大：{}",
                entry.name()
            )));
        }
        let mut raw = String::new();
        entry
            .read_to_string(&mut raw)
            .map_err(|error| AppError::Archive(error.to_string()))?;
        let metadata: PluginMetadata = serde_json::from_str(&raw)
            .map_err(|error| AppError::Archive(format!("{}：{error}", metadata_path.display())))?;
        validate_plugin_id(&metadata.id)?;
        if !ids.insert(metadata.id.clone()) {
            return Err(AppError::Archive(format!("插件 ID 重复：{}", metadata.id)));
        }
        let root = metadata_path
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .to_path_buf();
        let install_dir = archive_install_dir(&root, &metadata.id)?;
        let mut health = "ok".to_string();
        for required in [metadata.main_qml.as_deref(), metadata.main_so.as_deref()]
            .into_iter()
            .flatten()
            .filter(|value| !value.is_empty())
        {
            let relative = safe_relative_path(required)?;
            if !paths.contains(&root.join(relative)) {
                health = "missing-entry".into();
            }
        }
        candidates.push(ArchiveCandidate {
            root,
            install_dir,
            metadata,
            health,
        });
    }
    for (index, left) in candidates.iter().enumerate() {
        for right in candidates.iter().skip(index + 1) {
            if left.root.starts_with(&right.root) || right.root.starts_with(&left.root) {
                return Err(AppError::Archive(format!(
                    "插件目录相互嵌套，无法安全拆分：{} 与 {}",
                    display_archive_root(&left.root),
                    display_archive_root(&right.root)
                )));
            }
        }
    }
    candidates.sort_by(|a, b| a.root.cmp(&b.root));
    Ok(candidates)
}

fn extract_archive(path: &Path) -> AppResult<TempDir> {
    let destination = tempfile::tempdir()?;
    let file = fs::File::open(path)?;
    let mut archive = ZipArchive::new(file)?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| AppError::Archive(format!("包含不安全路径：{}", entry.name())))?
            .to_path_buf();
        validate_archive_path(&relative)?;
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(AppError::Archive(format!(
                "不允许符号链接：{}",
                entry.name()
            )));
        }
        let output = destination.path().join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&output)?;
            continue;
        }
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = fs::File::create(&output)?;
        std::io::copy(&mut entry, &mut file)?;
        file.flush()?;
    }
    Ok(destination)
}

fn validate_archive_path(path: &Path) -> AppResult<()> {
    if path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(AppError::Archive(format!("不安全路径：{}", path.display())));
    }
    Ok(())
}

fn safe_relative_path(value: &str) -> AppResult<PathBuf> {
    let path = PathBuf::from(value);
    validate_archive_path(&path)?;
    Ok(path)
}

fn validate_plugin_id(id: &str) -> AppResult<()> {
    if id.is_empty()
        || id.len() > 160
        || id.starts_with('.')
        || !id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
    {
        return Err(AppError::Archive(format!("插件 ID 不安全：{id}")));
    }
    Ok(())
}

fn archive_install_dir(root: &Path, plugin_id: &str) -> AppResult<String> {
    let name = if root.as_os_str().is_empty() {
        plugin_id.to_string()
    } else {
        root.file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| AppError::Archive("插件目录名不是有效的 UTF-8".into()))?
            .to_string()
    };
    validate_plugin_directory_name(&name)?;
    Ok(name)
}

fn validate_plugin_directory_name(name: &str) -> AppResult<()> {
    if name.is_empty()
        || name.len() > 255
        || name.starts_with('.')
        || name.contains(['/', '\\', '\0'])
    {
        return Err(AppError::Archive(format!("插件目录名不安全：{name}")));
    }
    Ok(())
}

fn ensure_unique_install_dirs(candidates: &[ArchiveCandidate]) -> AppResult<()> {
    let mut directories = HashSet::new();
    for candidate in candidates {
        if !directories.insert(&candidate.install_dir) {
            return Err(AppError::Archive(format!(
                "多个插件指定了相同的安装目录：{}",
                candidate.install_dir
            )));
        }
    }
    Ok(())
}

fn remote_file_name(path: &str) -> AppResult<&str> {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::Archive(format!("远程插件路径无效：{path}")))
}

fn rollback_command(target: &str, backups: &[(String, String)]) -> String {
    let restore = backups
        .iter()
        .map(|(original, backup)| {
            format!(
                "if [ -e {backup} ]; then mv {backup} {original}; fi",
                backup = shell_quote(backup),
                original = shell_quote(original),
            )
        })
        .collect::<Vec<_>>()
        .join("; ");
    format!("rm -rf {}; {restore}", shell_quote(target))
}

fn invalid_remote_plugin(path: &str, fallback_id: &str) -> PluginInfo {
    PluginInfo {
        id: fallback_id.to_string(),
        name: fallback_id.to_string(),
        version: String::new(),
        author: None,
        description: Some("无法读取 metadata.json".into()),
        path: path.to_string(),
        enabled: false,
        loaded: None,
        native: false,
        health: "invalid".into(),
        restart_required: false,
    }
}

fn display_archive_root(root: &Path) -> String {
    if root.as_os_str().is_empty() {
        "ZIP 根目录".into()
    } else {
        root.to_string_lossy().replace('\\', "/")
    }
}

fn normalize_root_string(value: &str) -> PathBuf {
    if value.is_empty() || value == "." || value == "ZIP 根目录" {
        PathBuf::new()
    } else {
        PathBuf::from(value)
    }
}

fn normalize_path(value: &Path) -> PathBuf {
    if value == Path::new(".") {
        PathBuf::new()
    } else {
        value.to_path_buf()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::SimpleFileOptions;

    fn create_archive(entries: &[(&str, &str)]) -> tempfile::NamedTempFile {
        let file = tempfile::NamedTempFile::new().unwrap();
        {
            let mut writer = zip::ZipWriter::new(file.reopen().unwrap());
            for (name, content) in entries {
                writer
                    .start_file(*name, SimpleFileOptions::default())
                    .unwrap();
                writer.write_all(content.as_bytes()).unwrap();
            }
            writer.finish().unwrap();
        }
        file
    }

    #[test]
    fn discovers_root_plugin() {
        let archive = create_archive(&[(
            "metadata.json",
            r#"{"id":"com.test.root","name":"Root","version":"1"}"#,
        )]);
        let plugins = discover_archive(archive.path()).unwrap();
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].metadata.id, "com.test.root");
        assert_eq!(plugins[0].install_dir, "com.test.root");
    }

    #[test]
    fn discovers_multiple_plugin_folders() {
        let archive = create_archive(&[
            (
                "bundle/a/metadata.json",
                r#"{"id":"com.test.a","name":"A","version":"1"}"#,
            ),
            (
                "bundle/b/metadata.json",
                r#"{"id":"com.test.b","name":"B","version":"1"}"#,
            ),
        ]);
        let plugins = inspect_archive(archive.path()).unwrap();
        assert_eq!(plugins.len(), 2);
    }

    #[test]
    fn exposes_plugin_author_from_metadata() {
        let archive = create_archive(&[(
            "plugin/metadata.json",
            r#"{"id":"com.test.author","name":"Authored","author":"Example Author"}"#,
        )]);
        let plugins = inspect_archive(archive.path()).unwrap();
        assert_eq!(plugins[0].plugin.author.as_deref(), Some("Example Author"));
    }

    #[test]
    fn preserves_the_metadata_directory_name_for_installation() {
        let archive = create_archive(&[(
            "release/Author Folder/metadata.json",
            r#"{"id":"com.test.folder","name":"Folder"}"#,
        )]);
        let plugins = discover_archive(archive.path()).unwrap();
        assert_eq!(plugins[0].install_dir, "Author Folder");
    }

    #[test]
    fn rejects_duplicate_install_directory_names() {
        let archive = create_archive(&[
            ("first/shared/metadata.json", r#"{"id":"com.test.first"}"#),
            ("second/shared/metadata.json", r#"{"id":"com.test.second"}"#),
        ]);
        let plugins = discover_archive(archive.path()).unwrap();
        assert!(ensure_unique_install_dirs(&plugins).is_err());
    }

    #[test]
    fn rejects_duplicate_ids() {
        let archive = create_archive(&[
            ("a/metadata.json", r#"{"id":"com.test.same"}"#),
            ("b/metadata.json", r#"{"id":"com.test.same"}"#),
        ]);
        assert!(inspect_archive(archive.path()).is_err());
    }
}
