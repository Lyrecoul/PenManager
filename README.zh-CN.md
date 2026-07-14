# PenManager

[English](README.md) | [简体中文](README.zh-CN.md)

PenManager 是一款面向网易有道词典笔二代和 PenMods 的跨平台桌面管理工具。
项目基于 Tauri 2、Rust、React、TypeScript 和 Material UI 开发。

## 功能

- 管理 ADB 和 SSH 连接配置
- 远程文件管理，支持上传、下载、重命名和带安全检查的删除操作
- 在多个标签页中使用持久化的 ADB Shell 和 SSH PTY 交互式终端
- 发现 PenMods 插件、查看状态、启用或禁用、删除备份，以及从 ZIP 安装插件
- 递归识别 ZIP 中位于根目录、包装目录或多插件归档中的插件
- 配置静态插件市场索引，并使用 SHA-256 校验下载内容
- 从 GitHub Releases 或最新成功的 GitHub Actions 构建更新 PenMods
- 查看设备信息并执行常用管理命令

## 开发

环境要求：

- Node.js 22 或更高版本
- Rust 1.85 或更高版本
- Linux：WebKitGTK 4.1 和 GTK 3 开发包

安装依赖并启动开发环境：

```sh
npm install
npm run tauri dev
```

`prepare:adb` 会下载官方 Android Platform Tools 归档，并将当前平台的 ADB 可执行文件缓存到
`src-tauri/binaries/` 目录。开发时可设置 `PENMANAGER_ADB` 环境变量，以使用指定的 ADB 可执行文件。

运行项目检查：

```sh
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

## 插件归档

PenManager 会递归搜索 ZIP 归档中的 `metadata.json`。每个有效元数据文件所在的目录都会被视为一个插件根目录。
因此，ZIP 可以直接在根目录放置插件，也可以使用单层包装目录，或者同时包含多个插件目录。安装位于包含目录中的插件时，
PenManager 会保留作者指定的目录名；位于 ZIP 根目录的插件则使用插件 ID 作为目录名。安装前，应用会预览所有识别到的候选插件。

解压过程会拒绝绝对路径、父级路径、符号链接、重复的插件 ID、嵌套的插件根目录、超大文件条目，以及缺少元数据所声明入口文件的归档。
替换现有插件前，PenManager 会先将原插件移动到带时间戳的备份目录。

插件市场索引格式请参阅 [docs/plugin-market-v1.zh-CN.md](docs/plugin-market-v1.zh-CN.md)。
