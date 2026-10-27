import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawn, spawnSync } from 'node:child_process';

let createService;
try { ({ createService } = await import('../src/service.mjs')); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }

const official = { auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens: { access_token: 'fixture-access-secret', id_token: 'fixture-id-secret', refresh_token: 'fixture-refresh-secret', account_id: 'fixture-account' }, last_refresh: '2026-10-27T00:00:00Z' };
const originalConfig = '# 用户原配置\nmodel = "original-model" # preserve this comment\nmodel_provider = "openai"\n\n[projects."/data/project"]\ntrust_level = "trusted"\n\n[mcp_servers.example]\ncommand = "example-server"\n';
const body = '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"中文聊天"}]}}\n{"type":"response_item","payload":{"type":"reasoning","encrypted_content":"opaque-do-not-touch"}}\n';

function fixture(t, options = {}) {
  assert.equal(typeof createService, 'function', 'the headless service must exist');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-terminal-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.writeFileSync(path.join(home, 'config.toml'), originalConfig);
  fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify(official));
  fs.mkdirSync(path.join(home, 'sessions', '2026', '10'), { recursive: true });
  const session = path.join(home, 'sessions', '2026', '10', 'rollout-test.jsonl');
  fs.writeFileSync(session, JSON.stringify({ type: 'session_meta', payload: { id: 'thread-1', model_provider: 'openai', model: 'historic-model', cwd: '/data/project' } }) + '\n' + body);
  const dbPath = path.join(home, 'state_5.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, model_provider TEXT NOT NULL, title TEXT, model TEXT);');
  db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?)').run('thread-1', 'openai', '原聊天', 'historic-model');
  db.close();
  return { home, session, dbPath, service: createService({ home, env: {}, ...options }) };
}

function provider(f) { return f.service.addApiProfile({ id: 'relay', name: '测试中转', url: 'https://relay.example/v1', model: 'relay-model', key: 'fixture-api-secret' }); }
function row(f, id = 'thread-1') { const db = new DatabaseSync(f.dbPath, { readOnly: true }); try { return db.prepare('SELECT * FROM threads WHERE id = ?').get(id); } finally { db.close(); } }
function header(f) { return JSON.parse(fs.readFileSync(f.session, 'utf8').split('\n')[0]); }

test('status reads an empty home without creating state or exposing secrets', async t => {
  const f = fixture(t);
  const s = await f.service.status();
  assert.equal(s.current.provider, 'openai');
  assert.equal(s.current.authentication, 'chatgpt');
  assert.equal(s.sessions.count, 1);
  assert.equal(fs.existsSync(path.join(f.home, '.cockpit-terminal')), false);
  assert.doesNotMatch(JSON.stringify(s), /fixture-(access|id|refresh|api)-secret/);
});

test('API switch changes config, auth and both indexes, preserving historical models and body bytes', async t => {
  const f = fixture(t); await provider(f);
  const before = fs.readFileSync(f.session).subarray(fs.readFileSync(f.session).indexOf(10) + 1);
  const preview = await f.service.previewSwitch('relay');
  assert.equal(preview.sessions, 1); assert.equal(preview.databaseRows, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.home, 'auth.json'))).auth_mode, 'chatgpt');
  const result = await f.service.switchTo('relay');
  assert.ok(result.backupId);
  const config = fs.readFileSync(path.join(f.home, 'config.toml'), 'utf8');
  assert.match(config, /# 用户原配置/); assert.match(config, /\[mcp_servers.example\]\ncommand = "example-server"/);
  assert.match(config, /requires_openai_auth = true/); assert.match(config, /https:\/\/relay.example\/v1/);
  const auth = JSON.parse(fs.readFileSync(path.join(f.home, 'auth.json')));
  assert.equal(auth.OPENAI_API_KEY, 'fixture-api-secret'); assert.equal(auth.tokens, undefined);
  assert.equal(header(f).payload.model_provider, 'cockpit_terminal_api');
  assert.equal(header(f).payload.model, 'historic-model');
  assert.equal(row(f).model_provider, 'cockpit_terminal_api'); assert.equal(row(f).model, 'historic-model');
  const after = fs.readFileSync(f.session); assert.deepEqual(after.subarray(after.indexOf(10) + 1), before);
  assert.doesNotMatch(JSON.stringify(result), /fixture-.*secret/);
});

test('round trip restores official credentials and model without sending API credentials to official auth', async t => {
  const f = fixture(t); await provider(f);
  await f.service.switchTo('relay'); await f.service.switchTo('official');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.home, 'auth.json'))), official);
  assert.equal((await f.service.status()).current.provider, 'openai');
  assert.match(fs.readFileSync(path.join(f.home, 'config.toml'), 'utf8'), /model = "original-model"/);
  assert.equal(header(f).payload.model_provider, 'openai'); assert.equal(row(f).model_provider, 'openai');
});

test('dry-run never updates credentials, session files, database rows or the backup list', async t => {
  const f = fixture(t); await provider(f);
  const before = fs.readFileSync(f.session); const beforeBackups = await f.service.backups();
  const result = await f.service.switchTo('relay', { dryRun: true });
  assert.equal(result.dryRun, true); assert.deepEqual(fs.readFileSync(f.session), before);
  assert.equal(row(f).model_provider, 'openai'); assert.deepEqual(await f.service.backups(), beforeBackups);
});

test('restoring a switch retains appended messages and newly created chats', async t => {
  const f = fixture(t); await provider(f);
  const result = await f.service.switchTo('relay');
  const extra = '{"type":"event_msg","payload":{"message":"切换后新消息"}}\n';
  fs.appendFileSync(f.session, extra);
  const newSession = path.join(f.home, 'sessions', 'new.jsonl');
  const newContent = '{"type":"session_meta","payload":{"id":"new-thread","model_provider":"cockpit_terminal_api"}}\n{"new":"new-chat"}\n';
  fs.writeFileSync(newSession, newContent);
  const db = new DatabaseSync(f.dbPath); db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?)').run('new-thread', 'cockpit_terminal_api', '新聊天', 'new-model'); db.close();
  await f.service.restore(result.backupId);
  assert.equal(fs.readFileSync(f.session, 'utf8').split('\n').slice(1).join('\n'), body + extra);
  assert.equal(header(f).payload.model_provider, 'openai'); assert.equal(row(f).model_provider, 'openai');
  assert.equal(row(f, 'new-thread').title, '新聊天'); assert.equal(fs.readFileSync(newSession, 'utf8'), newContent);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.home, 'auth.json'))), official);
});

test('an active Codex writer lock refuses changes and never deletes the lock', async t => {
  const f = fixture(t); await provider(f);
  const dir = path.join(f.home, 'thread-writer-locks'); fs.mkdirSync(dir);
  const lock = path.join(dir, 'thread-1.lock'); fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }));
  await assert.rejects(() => f.service.switchTo('relay'), /会话.*占用|writer|占用/);
  assert.equal(fs.existsSync(lock), true); assert.equal(row(f).model_provider, 'openai');
  assert.equal(fs.readFileSync(path.join(f.home, 'config.toml'), 'utf8'), originalConfig);
});

test('a busy SQLite writer leaves config, credentials and JSONL untouched', async t => {
  const f = fixture(t); await provider(f);
  const db = new DatabaseSync(f.dbPath); db.exec('BEGIN IMMEDIATE');
  try { await assert.rejects(() => f.service.switchTo('relay'), /busy|locked|占用/i); }
  finally { db.exec('ROLLBACK'); db.close(); }
  assert.equal(fs.readFileSync(path.join(f.home, 'config.toml'), 'utf8'), originalConfig);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.home, 'auth.json'))), official);
  assert.equal(header(f).payload.model_provider, 'openai');
});

test('restore refuses conflicting provider metadata before reverting configuration', async t => {
  const f = fixture(t); await provider(f); const result = await f.service.switchTo('relay');
  const text = fs.readFileSync(f.session, 'utf8').replace('"model_provider":"cockpit_terminal_api"', '"model_provider":"another-provider"'); fs.writeFileSync(f.session, text);
  await assert.rejects(() => f.service.restore(result.backupId), /冲突|conflict/i);
  assert.equal((await f.service.status()).current.provider, 'cockpit_terminal_api');
});

test('malformed session metadata aborts the entire operation without partial migration', async t => {
  const f = fixture(t); await provider(f);
  fs.writeFileSync(path.join(f.home, 'sessions', 'bad.jsonl'), '{not-json}\n');
  await assert.rejects(() => f.service.switchTo('relay'), /会话|JSON|metadata/);
  assert.equal(header(f).payload.model_provider, 'openai'); assert.equal(row(f).model_provider, 'openai');
});

test('explicit SQLite home does not silently migrate a different database', async t => {
  const f = fixture(t); await provider(f);
  const missing = path.join(f.home, 'missing-sqlite');
  const service = createService({ home: f.home, sqliteHome: missing, env: {} });
  await assert.rejects(() => service.switchTo('relay'), /SQLite|数据库/);
  assert.equal(row(f).model_provider, 'openai');
});

test('root-level switch refuses a selected Codex profile that overrides the provider', async t => {
  const f = fixture(t); await provider(f);
  fs.appendFileSync(path.join(f.home, 'config.toml'), '\n[profiles.custom]\nmodel_provider = "other"\n');
  const text = fs.readFileSync(path.join(f.home, 'config.toml'), 'utf8');
  fs.writeFileSync(path.join(f.home, 'config.toml'), 'profile = "custom"\n' + text);
  await assert.rejects(() => f.service.switchTo('relay'), /profile|配置档/);
});

test('invalid provider IDs, URLs and backup paths are rejected', async t => {
  const f = fixture(t);
  await assert.rejects(() => f.service.addApiProfile({ id: '../escape', name: 'bad', url: 'https://relay.example/v1', key: 'key' }), /ID|名称/);
  await assert.rejects(() => f.service.addApiProfile({ id: 'bad', name: 'bad', url: 'https://user:password@relay.example/v1?key=secret', key: 'key' }), /URL|地址/);
  await assert.rejects(() => f.service.restore('../../auth.json'), /备份|backup/i);
});

test('status and previews redact API credentials and official tokens', async t => {
  const f = fixture(t); await provider(f); await f.service.importOfficial({ id: 'official' });
  const output = JSON.stringify([await f.service.status(), await f.service.previewSwitch('relay'), await f.service.backups()]);
  assert.doesNotMatch(output, /fixture-(api|access|refresh|id)-secret/);
});

test('Linux private credentials and backups use owner-only file modes', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t); await provider(f); const result = await f.service.switchTo('relay');
  assert.equal(fs.statSync(path.join(f.home, '.cockpit-terminal')).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(f.home, '.cockpit-terminal', 'registry.json')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(f.home, 'auth.json')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(f.home, '.cockpit-terminal', 'backups', result.backupId, 'manifest.json')).mode & 0o777, 0o600);
});

test('a minimal config without tables keeps provider and auth settings at the root', async t => {
  const f = fixture(t); await provider(f);
  fs.writeFileSync(path.join(f.home, 'config.toml'), 'model = "original-model" # keep\n');
  await f.service.switchTo('relay');
  const s = await f.service.status();
  assert.equal(s.current.provider, 'cockpit_terminal_api');
  assert.equal(s.current.model, 'relay-model');
  assert.match(fs.readFileSync(path.join(f.home, 'config.toml'), 'utf8'), /# keep/);
});

test('an empty config creates valid root settings before the managed provider table', async t => {
  const f = fixture(t); await provider(f);
  fs.writeFileSync(path.join(f.home, 'config.toml'), '');
  await f.service.switchTo('relay');
  assert.equal((await f.service.status()).current.provider, 'cockpit_terminal_api');
});

test('switching an explicitly imported official account does not replace it with the live account', async t => {
  const f = fixture(t);
  const second = { auth_mode: 'chatgpt', tokens: { access_token: 'second-access', refresh_token: 'second-refresh', account_id: 'second-account' } };
  const imported = path.join(f.home, 'second-auth.json'); fs.writeFileSync(imported, JSON.stringify(second));
  await f.service.importOfficial({ id: 'official', file: imported, name: '账号 B' });
  await f.service.switchTo('official');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.home, 'auth.json'))), second);
  assert.ok((await f.service.status()).profiles.some(p => p.type === 'official' && p.id !== 'official'), 'live account A must also remain saved');
});

test('switch rejects an expired interactive preview rather than applying a different plan', async t => {
  const f = fixture(t); await provider(f);
  const preview = await f.service.previewSwitch('relay');
  fs.appendFileSync(f.session, '{"type":"event_msg","payload":{"message":"during-preview"}}\n');
  await assert.rejects(() => f.service.switchTo('relay', { expectedToken: preview.token }), /预览.*过期|预览.*变化/);
  assert.equal(row(f).model_provider, 'openai'); assert.equal(header(f).payload.model_provider, 'openai');
});

test('recovery converges to the original state even if a previous recovery process crashes', async t => {
  const f = fixture(t); await provider(f);
  const moduleUrl = new URL('../src/service.mjs', import.meta.url).href;
  const crash = (operation, destination, code) => spawnSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    const original = fs.renameSync;
    fs.renameSync = function(a,b) { const result=original(a,b); if(String(b).endsWith(${JSON.stringify(destination)})) process.exit(${code}); return result; };
    const {createService}=await import(${JSON.stringify(moduleUrl)});
    const service=createService({home:${JSON.stringify(f.home)},env:{}});
    await service.${operation};
  `], { encoding: 'utf8' });
  assert.equal(crash("switchTo('relay')", 'config.toml', 77).status, 77);
  assert.equal(crash('recover()', 'pending-operation.json', 78).status, 78);
  await f.service.recover();
  assert.equal((await f.service.status()).current.provider, 'openai');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.home, 'auth.json'))), official);
  assert.equal(row(f).model_provider, 'openai'); assert.equal(header(f).payload.model_provider, 'openai');
  assert.equal(fs.existsSync(path.join(f.home, '.cockpit-terminal', 'pending-operation.json')), false);
});

test('two recovery processes cannot both take ownership of the same stale operation lock', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-lock-concurrency-')); t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const state = path.join(home, '.cockpit-terminal'); const lock = path.join(state, 'operation.lock');
  fs.mkdirSync(lock, { recursive: true }); fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: 2147483000, hostname: os.hostname() }));
  const moduleUrl = new URL('../src/files.mjs', import.meta.url).href;
  const run = id => new Promise((resolve, reject) => {
    const script = `
      import fs from 'node:fs'; import path from 'node:path';
      const home=${JSON.stringify(home)}, state=${JSON.stringify(state)}, id=${id};
      const original=fs.readFileSync;
      fs.readFileSync=function(file,...args){const result=original(file,...args); if(String(file).endsWith('owner.json')&&String(result).includes('2147483000')){
        fs.writeFileSync(path.join(home,'read-'+id),'ready'); const until=Date.now()+500;
        while(Date.now()<until&&!(fs.existsSync(path.join(home,'read-0'))&&fs.existsSync(path.join(home,'read-1')))) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
        if(id===1) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,80);
      } return result;};
      const {operationLock}=await import(${JSON.stringify(moduleUrl)});
      try { const release=operationLock(state,{recovery:true}); process.stdout.write('acquired'); await new Promise(r=>setTimeout(r,900)); release(); }
      catch { process.stdout.write('refused'); }
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] }); let output = '';
    child.stdout.on('data', data => output += data); child.on('error', reject); child.on('exit', code => code === 0 ? resolve(output) : reject(new Error(`lock child failed: ${code}`)));
  });
  const results = await Promise.all([run(0), run(1)]);
  assert.equal(results.filter(value => value === 'acquired').length, 1, JSON.stringify(results));
});

test('a registry changed after its first read is rejected rather than losing the other saved account', async t => {
  const f = fixture(t);
  const second = createService({ home: f.home, env: {} });
  const original = f.service.registry.bind(f.service); let intervened = false; let secondResult;
  f.service.registry = () => {
    const snapshot = original();
    if (!intervened) {
      intervened = true;
      secondResult = second.addApiProfile({ id: 'second', url: 'https://second.example/v1', key: 'second-key' });
    }
    return snapshot;
  };
  await assert.rejects(() => f.service.addApiProfile({ id: 'first', url: 'https://first.example/v1', key: 'first-key' }), /冲突|变化/);
  await secondResult;
  const profiles = (await second.status()).profiles;
  assert.equal(profiles.some(p => p.id === 'second'), true); assert.equal(profiles.some(p => p.id === 'first'), false);
});

test('official credentials are retained even when the existing config selects a custom provider', async t => {
  const f = fixture(t); await provider(f);
  fs.writeFileSync(path.join(f.home, 'config.toml'), 'model = "original-model"\nmodel_provider = "existing_relay"\n[model_providers.existing_relay]\nbase_url = "https://old.example/v1"\nrequires_openai_auth = true\n');
  await f.service.switchTo('relay');
  await f.service.switchTo('official');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.home, 'auth.json'))), official);
});

test('a crash before writing diagnostic owner metadata remains recoverable', async t => {
  const f = fixture(t); const moduleUrl = new URL('../src/service.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs'; import path from 'node:path';
    const original=fs.mkdirSync; fs.mkdirSync=function(dir,...args){const result=original(dir,...args); if(path.basename(dir)==='operation.lock') process.exit(79); return result;};
    const {createService}=await import(${JSON.stringify(moduleUrl)});
    await createService({home:${JSON.stringify(f.home)},env:{}}).addApiProfile({id:'relay',url:'https://relay.example/v1',key:'test-key'});
  `], { encoding: 'utf8' });
  assert.equal(child.status, 79);
  assert.equal((await f.service.recover()).noop, true);
  await provider(f);
  assert.equal((await f.service.status()).profiles.some(p => p.id === 'relay'), true);
});

test('sync preview is bound to the database path even when two databases contain identical rows', async t => {
  const f = fixture(t); await provider(f); await f.service.switchTo('relay');
  // Restore the original provider tags to give sync work in both databases.
  const headerText = fs.readFileSync(f.session, 'utf8').replace('"model_provider":"cockpit_terminal_api"', '"model_provider":"openai"'); fs.writeFileSync(f.session, headerText);
  const db = new DatabaseSync(f.dbPath); db.exec("UPDATE threads SET model_provider='openai'"); db.close();
  const second = path.join(f.home, 'second-db'); fs.mkdirSync(second); const secondPath = path.join(second, 'state_5.sqlite'); fs.copyFileSync(f.dbPath, secondPath);
  const preview = await f.service.previewSync();
  const configPath = path.join(f.home, 'config.toml'); const config = fs.readFileSync(configPath, 'utf8');
  fs.writeFileSync(configPath, `sqlite_home = ${JSON.stringify(second).replace(/\\\\/g, '\\\\')}\n` + config);
  await assert.rejects(() => f.service.sync({ expectedToken: preview.token }), /预览.*过期|预览.*变化/);
  const check = new DatabaseSync(secondPath, { readOnly: true });
  assert.equal(check.prepare('SELECT model_provider FROM threads').get().model_provider, 'openai'); check.close();
});

test('account list order remains stable after automatic official credential capture', async t => {
  const f = fixture(t); await provider(f);
  const before = (await f.service.status()).profiles.map(p => p.id);
  await f.service.switchTo('relay');
  assert.deepEqual((await f.service.status()).profiles.map(p => p.id), before);
});

test('a stale no-op recovery never deletes a newer interrupted operation journal', async t => {
  const f = fixture(t); const moduleUrl = new URL('../src/service.mjs', import.meta.url).href;
  fs.writeFileSync(f.session, fs.readFileSync(f.session, 'utf8').replace('"model_provider":"openai"', '"model_provider":"old"'));
  const db = new DatabaseSync(f.dbPath); db.exec("UPDATE threads SET model_provider='old'"); db.close();
  const crashSync = destination => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs'; const original=fs.renameSync;
      fs.renameSync=function(a,b){const result=original(a,b); if(String(b).endsWith(${JSON.stringify(destination)})) process.exit(80); return result;};
      const {createService}=await import(${JSON.stringify(moduleUrl)});
      await createService({home:${JSON.stringify(f.home)},env:{}}).sync();
    `], { encoding: 'utf8' });
    assert.equal(child.status, 80, child.stderr);
  };
  crashSync('pending-operation.json');
  const second = createService({ home: f.home, env: {} }); const original = f.service.apply.bind(f.service); let intervened = false;
  f.service.apply = async (plan, options) => {
    if (!intervened) { intervened = true; await second.recover(); crashSync('rollout-test.jsonl'); }
    return original(plan, options);
  };
  await assert.rejects(() => f.service.recover(), /恢复.*变化|日志.*变化|恢复.*过期/);
  assert.equal(fs.existsSync(path.join(f.home, '.cockpit-terminal', 'pending-operation.json')), true);
  assert.equal(header(f).payload.model_provider, 'openai'); assert.equal(row(f).model_provider, 'old');
  await second.recover();
  assert.equal(header(f).payload.model_provider, 'old'); assert.equal(row(f).model_provider, 'old');
});
