#!/usr/bin/env bash
set -euo pipefail
export PATH="$1:$PATH"
package_test_dir=$(mktemp -d /tmp/cockpit-package-XXXXXX)
cleanup() {
  case "$package_test_dir" in
    /tmp/cockpit-package-*) rm -rf -- "$package_test_dir" ;;
    *) printf 'Refusing unexpected cleanup target\n' >&2 ;;
  esac
}
trap cleanup EXIT
npm install --prefix "$package_test_dir/install" "$2" --ignore-scripts --no-audit --no-fund
executable="$package_test_dir/install/node_modules/.bin/cockpit-terminal"
"$executable" --version
"$executable" status --codex-home "$package_test_dir/codex" --json > "$package_test_dir/status.json"
node --input-type=module - "$package_test_dir/status.json" <<'JS'
import fs from 'node:fs';
import assert from 'node:assert/strict';
const data=JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.equal(data.ok,true);
assert.equal(data.result.current.provider,'openai');
assert.equal(data.result.sessions.count,0);
assert.equal(fs.existsSync(data.result.home),false);
process.stdout.write('Package install + command startup + read-only status: PASS\n');
JS
