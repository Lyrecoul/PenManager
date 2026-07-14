# PenManager 插件市场索引 v1

[English](plugin-market-v1.md) | [简体中文](plugin-market-v1.zh-CN.md)

v1 版插件市场是一份通过 HTTPS 提供的静态 JSON 文档。它不需要服务器、用户账户或独立的软件包托管服务。
插件发布归档可继续存放在各插件作者的 GitHub Releases 中。

```json
{
  "schema_version": 1,
  "name": "示例 PenMods 插件市场",
  "plugins": [
    {
      "id": "com.example.plugin",
      "name": "示例插件",
      "summary": "面向用户的简短描述",
      "author": "示例作者",
      "repository": "example/penmods-plugin",
      "icon": "https://example.invalid/icon.png",
      "versions": [
        {
          "version": "1.0.0",
          "url": "https://example.invalid/plugin.zip",
          "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          "devices": ["YDP02X"],
          "min_penmods": "2.0.0",
          "native": true,
          "roots": ["plugins/com.example.plugin"]
        }
      ]
    }
  ]
}
```

`roots` 字段可选。指定该字段时，PenManager 会从包含多个插件的归档中选取与其精确匹配的插件根目录。
未指定时，PenManager 会安装归档中发现的所有有效插件。从本地 ZIP 安装插件时，应用始终会显示候选插件选择界面。

每个版本都必须提供 SHA-256 摘要。除了开发时使用的 localhost 地址，PenManager 只接受 HTTPS URL。
未来的索引版本可以在不修改 PenMods 运行时元数据的前提下增加发布者签名。
