# PenManager Plugin Market Index v1

[English](plugin-market-v1.md) | [简体中文](plugin-market-v1.zh-CN.md)

The v1 market is a static HTTPS JSON document. It does not require a server, user account, or package hosting.
Release archives can remain in each plugin author's GitHub Releases.

```json
{
  "schema_version": 1,
  "name": "Example PenMods Market",
  "plugins": [
    {
      "id": "com.example.plugin",
      "name": "Example Plugin",
      "summary": "Short user-facing description",
      "author": "Example Author",
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

`roots` is optional. When present, it selects exact plugin roots from a bundle archive. When absent, PenManager
installs every valid plugin discovered in the archive. Local ZIP installation always shows a candidate selector.

Every version must provide a SHA-256 digest. PenManager only accepts HTTPS URLs, except localhost URLs used for
development. A future schema can add publisher signatures without changing PenMods runtime metadata.
