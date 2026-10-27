#!/usr/bin/env bash
set -euo pipefail
export PATH="$1:$PATH"
portable_test_dir=$(mktemp -d /tmp/cockpit-portable-XXXXXX)
cleanup() {
  case "$portable_test_dir" in
    /tmp/cockpit-portable-*) rm -rf -- "$portable_test_dir" ;;
    *) printf 'Refusing unexpected cleanup target\n' >&2 ;;
  esac
}
trap cleanup EXIT
case "$2" in
  *.tar.gz) tar -xzf "$2" -C "$portable_test_dir" ;;
  *.zip) python3 -m zipfile -e "$2" "$portable_test_dir" ;;
  *) printf 'Expected .zip or .tar.gz package\n' >&2; exit 1 ;;
esac
executable="$portable_test_dir/cockpit-tools-terminal/bin/cockpit-terminal.mjs"
node "$executable" --help > /dev/null
node "$executable" status --codex-home "$portable_test_dir/codex" --json > "$portable_test_dir/status.json"
node --input-type=module - "$portable_test_dir/status.json" <<'JS'
import fs from 'node:fs';
import assert from 'node:assert/strict';
const result=JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.equal(result.ok,true);
assert.equal(result.result.sessions.count,0);
assert.equal(fs.existsSync(result.result.home),false);
process.stdout.write('Offline portable package + dependency resolution + read-only status: PASS\n');
JS
