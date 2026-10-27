import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const executable = fileURLToPath(new URL('../bin/cockpit-terminal.mjs', import.meta.url));

test('help starts without a GUI or a Codex home', () => {
  const result = spawnSync(process.execPath, [executable, '--help'], { encoding: 'utf8', env: { ...process.env, CODEX_HOME: '/does-not-exist-cockpit-test' } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /switch/);
  assert.match(result.stdout, /restore/);
});

test('CLI profile/add/switch/official round trip works with environment secrets and JSON output', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-cli-roundtrip-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.writeFileSync(path.join(home, 'config.toml'), 'model = "official-test-model"\n');
  const auth = { tokens: { access_token: 'cli-access-secret', refresh_token: 'cli-refresh-secret' } };
  fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify(auth));
  const run = args => {
    const result = spawnSync(process.execPath, [executable, ...args, '--codex-home', home, '--json'], { encoding: 'utf8', env: { ...process.env, OPENAI_BASE_URL: '', COCKPIT_TEST_KEY: 'cli-api-secret' } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /cli-(api|access|refresh)-secret/);
    return JSON.parse(result.stdout).result;
  };
  run(['profile', 'add', 'relay', '--url', 'https://relay.example/v1', '--model', 'relay-model', '--key-env', 'COCKPIT_TEST_KEY']);
  assert.equal(run(['profile', 'list']).some(p => p.id === 'relay'), true);
  assert.equal(run(['switch', 'relay', '--dry-run']).dryRun, true);
  run(['switch', 'relay']); assert.equal(run(['status']).current.authentication, 'apikey');
  run(['switch', 'official']); assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'auth.json'))), auth);
});

test('unknown options and missing API credentials fail without creating a Codex home', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-cli-errors-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'not-created');
  for (const args of [['--unknown-option'], ['profile', 'add', 'relay', '--url', 'https://relay.example/v1']]) {
    const result = spawnSync(process.execPath, [executable, ...args, '--codex-home', home, '--json'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(result.stdout).ok, false);
    assert.equal(fs.existsSync(home), false);
  }
});
