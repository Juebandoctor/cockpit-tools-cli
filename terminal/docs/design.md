# Codex terminal edition — approved design, 2026-10-27

The user approved a standalone Node.js terminal module inside Cockpit Tools, initially covering Codex official/API switching, session synchronization, and backup/restore. WSL testing is explicitly authorized. The original desktop application remains intact.

## Boundaries

- Node.js >=22.16; no Tauri, GTK, display server, or browser runtime. Node's bundled SQLite implementation avoids native npm modules.
- A keyboard-controlled terminal dashboard plus scriptable commands share one service layer.
- Resolve Codex Home from explicit argument, CODEX_HOME, then ~/.codex. Inspect actual config and SQLite locations rather than assuming the local Windows home is the server home.
- Store terminal profiles and credential snapshots under the selected Codex Home in a private .cockpit-terminal directory. No credentials in command arguments, status output, terminal logs, or committed fixtures.
- Import an existing official auth.json; retain the freshest official credentials before switching to API authentication. API profiles use Responses-compatible endpoints and auth.json API-key credentials. Selecting official restores its account snapshot and the built-in openai provider.
- Preserve unrelated TOML text, models in old session records, all messages, encrypted contents, file paths, and original session IDs. Only provider metadata and the corresponding SQLite column are synchronized.
- Explicit profiles configured in Codex must be diagnosed and rejected if their overrides make a root-level switch ineffective; do not silently rewrite unrelated profiles.
- Preview before interactive writes. Each mutation has a private backup and a recoverable journal. Detect concurrent terminal operations and existing Codex writer locks. Do not terminate Codex or delete its locks.
- Restore session metadata and targeted database provider values, not whole historical databases or session bodies; messages/new chats created after a switch must survive restoration.
- Full rollback for handled write errors. An interrupted operation leaves a journal and blocks further writes until explicit recovery.
- This edition does not promise cross-provider decryption, token refresh/OAuth implementation, live quota retrieval, other platforms, API gateway service, or automatic VS Code reload.

## UI

Full terminal dashboard with overview, providers/accounts, sessions, and backups. Arrow keys select, Tab cycles pages, Enter previews an action, Y confirms, A adds an API profile, I imports official credentials, S previews synchronization, R previews restore, Esc cancels, Q exits. API-key entry is masked. Narrow terminals show a compact, bounded layout.

## Verification

Use isolated temporary Codex Homes, real SQLite databases, JSONL sessions containing Chinese text and opaque encrypted payloads, and synthetic credentials. Test official/API round trips, unknown providers, preserving comments and multi-line TOML, session body integrity, busy locks, partial failures, conflict detection, restore after appended messages/new chats, secrets redaction, path validation, Linux permissions, and actual pseudo-terminal keyboard flows under WSL. No request is sent to any model or account during testing.
