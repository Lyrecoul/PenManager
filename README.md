# PenManager

[English](README.md) | [简体中文](README.zh-CN.md)

PenManager is a cross-platform desktop manager for the NetEase Youdao Dictionary Pen 2 and PenMods.
It uses Tauri 2, Rust, React, TypeScript, and Material UI.

## Features

- ADB and SSH connection profiles
- Remote file manager with upload, download, rename, and safe deletion guards
- Persistent interactive ADB shell and SSH PTY terminal tabs
- PenMods plugin discovery, state inspection, enable/disable, backup removal, and ZIP installation
- Recursive ZIP discovery for root plugins, wrapped plugins, and multi-plugin archives
- Configurable static plugin market indexes with SHA-256 verification
- PenMods updates from GitHub Releases or the latest successful GitHub Actions build
- Device information and common management commands

## Development

Requirements:

- Node.js 22 or newer
- Rust 1.85 or newer
- Linux: WebKitGTK 4.1 and GTK 3 development packages

```sh
npm install
npm run tauri dev
```

`prepare:adb` downloads the official Android Platform Tools archive once and caches the host ADB binary
under `src-tauri/binaries/`. Set `PENMANAGER_ADB` to use a specific ADB executable during development.

Run checks:

```sh
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

## Plugin archives

PenManager recursively searches a ZIP archive for `metadata.json`. The containing directory of each valid
metadata file is treated as one plugin root. This supports a plugin at the ZIP root, a single wrapper directory,
or multiple plugin directories. A containing directory keeps its author-provided name when installed; a plugin
at the ZIP root uses its plugin ID as the directory name. The application previews all candidates before installation.

Archive extraction rejects absolute or parent paths, symbolic links, duplicate IDs, nested plugin roots,
oversized entries, and missing declared entry files. Existing plugins are moved to a timestamped backup before
replacement.

See [docs/plugin-market-v1.md](docs/plugin-market-v1.md) for the plugin market index format.
