# Codex Terminal Implementation Plan

**Goal:** Deliver the approved Codex terminal dashboard and commands inside the upstream source tree.

**Architecture:** A standalone ESM package. Configuration editing, session headers, SQLite indexing, private backups/locking, and the service are separate modules. The CLI and ANSI terminal dashboard consume the same service. No desktop dependencies.

**Global constraints:** Node >=22.16; scoped Codex Home; no real credentials in tests; no destructive chat-history rewriting; preserve upstream licensing and attribution.

## Task 1 — Configuration and filesystem contracts
- [x] Write real CLI/config tests, observe failure, then implement parsing, targeted TOML edits, path resolution, private atomic files, and redacted profile storage.
- [x] Verify config preservation, API auth, official credential import, profile overrides, minimal/empty TOML and environment diagnostics. Advanced TOML layouts fail closed when incremental edits cannot be validated.

## Task 2 — Provider synchronization and recovery
- [x] Write SQLite/JSONL integration tests first; preserve bytes after the first session line and retain history model fields.
- [x] Implement operation locks, writer-lock checks, snapshots, hash revalidation, rollback journal, metadata-only restore, and interrupted-operation recovery.
- [x] Verify restore retains appended messages and newly created chats; conflicts and busy writers leave targets untouched. Add crash-during-recovery, stale journal, concurrent recovery, and registry lost-update regressions.

## Task 3 — Commands and terminal dashboard
- [x] Implement help/status/profile add/import/switch/sync/backups/restore/recover with JSON output and dry-run support.
- [x] Implement a bounded keyboard-driven dashboard and masked forms, sharing the service and previews.
- [x] Add Chinese installation/Remote-SSH instructions and the exact upstream provenance.

## Task 4 — WSL acceptance
- [x] Execute the full suite with a native Linux Node runtime and Linux temporary homes.
- [x] Exercise real PTY navigation, provider forms, switch confirmation, cancel, restore, resize, and normal exit.
- [x] Verify distribution package installation and command startup; record tested scope and limitations.
