# Attribution and scope

This is a local, independent Codex terminal adaptation inside the source tree of **Cockpit Tools**, originally by **jlcodes99 and contributors**:

- Upstream: https://github.com/jlcodes99/cockpit-tools
- Source snapshot commit: `2cfe5e51314bfc0bf70bdda1ba08aed82c7dc8bf`
- Snapshot obtained: 2026-10-27
- Upstream desktop package version in this snapshot: 1.3.75

The upstream Cargo packages declare **CC-BY-NC-SA-4.0**, and the upstream README describes the same license. This adaptation retains that declaration and attribution. License text: https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode

The `terminal/` package is newly implemented, independently of the Tauri GUI. Its configuration/authentication conventions and server-facing scope are informed by the upstream Codex modules. No code, assets or dependency from CC-Switch CLI or codex-provider-sync was copied. Third-party npm packages retain their own licenses, included by npm.

This package is not an upstream Cockpit Tools release and is not an official OpenAI product. The upstream desktop files are preserved. Version 0.1.0 implements only the user-approved Codex official/API switching, provider metadata synchronization, backups/recovery, scriptable commands and terminal dashboard; it does not port all desktop features.
