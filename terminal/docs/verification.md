# Verification — 2026-10-27

## Environments

- Windows host: Node v24.19.0.
- WSL: Ubuntu 22.04, native Linux x86_64 Node v24.22.1. Official Node archive SHA-256 verified as `6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6` before extraction. Runtime is isolated at `~/.local/share/cockpit-terminal-test-runtime`, not installed globally.
- Tests use temporary Codex Homes and synthetic credentials only. No model request or real-account login was sent.

## Acceptance results

- `node --test test/*.test.mjs`: 31 tests; Windows 30 passed, one Unix-permissions test skipped; WSL 31 passed, zero failures/skips.
- `npm run check`: ESM entry/service/dashboard syntax checks pass.
- `npm audit --omit=dev`: zero reported vulnerabilities at verification time.
- Real Linux pseudo-terminal: nine acceptance checks pass, including form entry without secret disclosure, cancelling writes, API/official switching, actual JSONL/SQLite migration, restoring a backup, sync preview/cancel, resize to 48x18, and terminal cursor/screen restoration.
- npm tarball: installed into an isolated WSL prefix, version/help/status entry points verified; read-only status does not create the selected Codex Home.
- Offline ZIP: extracted into an isolated WSL directory, bundled pure-JS dependencies load and read-only status succeeds without npm installation.
- Original upstream source preservation: all 4,289 files from source ZIP checked against their ZIP CRC; zero missing/modified files. Snapshot commit `2cfe5e51314bfc0bf70bdda1ba08aed82c7dc8bf`.

## Failure and concurrency cases

The tests include busy SQLite and Codex writer locks; metadata conflicts; malformed JSONL; explicit missing SQLite location; selected Codex profile overriding root settings; different imported official accounts; preserving official auth under an existing custom Provider; stale previews; database path changed after preview; keeping appended messages/new chats on restore; process death during recovery; simultaneous stale-lock recovery; missing diagnostic owner after a crash; stale registry updates; and stale no-op recovery encountering a newer interrupted operation.

These were exercised against real temporary files and SQLite databases. Crash cases exit child processes at real filesystem publication points. No production test hooks were added.

## Remaining limits

- No end-to-end connection to the user's actual server, VS Code extension, ChatGPT account or relay was performed. Actual provider authentication and continuing encrypted historical context remain unverified.
- No automatic VS Code restart, OAuth/token-refresh engine, quota query, API gateway, or other desktop platforms are included.
- Windows and Linux were tested; macOS was not tested.
- The minimum declared Node version is 22.16.0; the actual test runtimes are Node 24 above.
- The backups are targeted configuration/auth/provider-metadata backups, not whole-session-content or whole-machine backups. Credentials are private local files, not encrypted storage.
