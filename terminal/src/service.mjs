import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { hash, encode, decode, readOptional, readJson, privateDir, assertRegular, atomicWrite, jsonBytes, inside, checkWriterLocks, operationLock } from './files.mjs';
import { API_PROVIDER, loadConfig, editConfig, assertNoProfileOverrides, findDatabase } from './config.mjs';
import { scanSessions, readHeader, providerHeader, replaceHeader } from './sessions.mjs';
import { databaseRows, beginDatabase, updateDatabase } from './database.mjs';

const isOfficial = auth => auth?.auth_mode !== 'apikey' && typeof auth?.tokens?.access_token === 'string' && !!auth.tokens.access_token;
const authKind = auth => isOfficial(auth) ? 'chatgpt' : auth?.OPENAI_API_KEY ? 'apikey' : 'unknown';
const clean = text => String(text ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
const backupPattern = /^\d{17}-[a-f0-9]{8}$/;
const profilePattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/;
const equal = (a, b) => a === null ? b === null : b !== null && Buffer.from(a).equals(Buffer.from(b));
const registrySnapshot = Symbol('original-registry-bytes');
function sameAccount(a, b) {
  if (!isOfficial(a) || !isOfficial(b)) return false;
  if (a.tokens.account_id && b.tokens.account_id) return a.tokens.account_id === b.tokens.account_id;
  if (a.tokens.refresh_token && b.tokens.refresh_token) return a.tokens.refresh_token === b.tokens.refresh_token;
  return a.tokens.access_token === b.tokens.access_token;
}

function safeProfile(p) {
  return { id: p.id, name: p.name, type: p.type, url: p.url ?? null, model: p.model ?? null, available: p.type === 'api' ? !!p.key : isOfficial(p.auth) };
}

export function createService(options = {}) { return new CodexService(options); }

class CodexService {
  constructor({ home, sqliteHome, env = process.env } = {}) {
    const chosen = path.resolve(home ?? env.CODEX_HOME ?? path.join(os.homedir(), '.codex'));
    this.home = fs.existsSync(chosen) ? fs.realpathSync(chosen) : chosen;
    this.sqliteHome = sqliteHome; this.env = env;
    this.state = path.join(this.home, '.cockpit-terminal');
    this.registryPath = path.join(this.state, 'registry.json');
    this.journalPath = path.join(this.state, 'pending-operation.json');
    this.backupRoot = path.join(this.state, 'backups');
  }

  registry() {
    const bytes = readOptional(this.registryPath); let r;
    try { r = bytes === null ? { schema: 1, active: null, profiles: {} } : JSON.parse(bytes.toString('utf8')); }
    catch { throw new Error('终端账号配置 JSON 无效；保留原文件并停止。'); }
    if (r.schema !== 1 || !r.profiles || typeof r.profiles !== 'object' || Array.isArray(r.profiles)) throw new Error('终端账号配置格式不支持；保留原文件并停止。');
    const copy = structuredClone(r); Object.defineProperty(copy, registrySnapshot, { value: bytes }); return copy;
  }

  auth() { return readJson(path.join(this.home, 'auth.json'), null); }
  dbFile(config) { return findDatabase(this.home, config, this.sqliteHome, this.env); }

  async status() {
    const config = loadConfig(this.home); const auth = this.auth(); const registry = this.registry(); const warnings = [];
    let sessions = []; let rows = []; let database = null;
    try { sessions = scanSessions(this.home); } catch (e) { warnings.push(e.message); }
    try { database = this.dbFile(config.data); rows = databaseRows(database); } catch (e) { warnings.push(e.message); }
    if (!database) warnings.push('未找到 SQLite 聊天索引；首次使用 Codex 时可能尚未生成。');
    if (Object.keys(this.env).some(key => ['OPENAI_BASE_URL', 'OPENAI_API_KEY', 'CODEX_SQLITE_HOME'].includes(key) && this.env[key])) warnings.push('检测到环境变量覆盖；请同时核对远程 VS Code 插件进程的环境，当前终端环境不一定与插件一致。');
    if (config.data.profile) warnings.push(`Codex 当前选择配置档 profile=${clean(config.data.profile)}，切换前将检查覆盖项。`);
    if (fs.existsSync(this.journalPath)) warnings.push('存在中断的操作：请先运行 recover，新的写操作已禁用。');
    const profiles = Object.values(registry.profiles).sort((a, b) => Number(b.type === 'official') - Number(a.type === 'official') || a.id.localeCompare(b.id)).map(safeProfile);
    if (!registry.profiles.official) profiles.unshift({ id: 'official', name: '官方 ChatGPT 账号', type: 'official', url: null, model: config.data.model ?? null, available: isOfficial(auth) });
    const distribution = {};
    for (const s of sessions) distribution[s.provider] = (distribution[s.provider] ?? 0) + 1;
    return {
      home: this.home, database,
      current: { provider: config.data.model_provider ?? 'openai', profile: registry.active, model: config.data.model ?? null, authentication: authKind(auth) },
      profiles, sessions: { count: sessions.length, databaseRows: rows.length, distribution },
      backups: (await this.backups()).length, pendingRecovery: fs.existsSync(this.journalPath), warnings
    };
  }

  validateProfileId(id) {
    if (!profilePattern.test(id ?? '') || id === 'openai' || id === API_PROVIDER) throw new Error('账号 ID 必须是 1–48 位字母、数字、下划线或连字符，且不能使用保留名称。');
  }

  async addApiProfile({ id, name, url, model, key }) {
    this.validateProfileId(id);
    if (id === 'official') throw new Error('official 是官方账号的保留 ID。');
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error('中转 URL 地址无效。'); }
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('中转 URL 地址只允许 http/https，不得包含用户名、密码、查询参数或 fragment。');
    if (typeof key !== 'string' || !key.trim() || /[\r\n\u0000]/.test(key) || /^https?:\/\//i.test(key.trim())) throw new Error('API Key 不能为空、不能是 URL，也不能包含换行。');
    const registry = this.registry();
    if (registry.profiles[id]) throw new Error('该账号 ID 已存在，请使用另一个 ID；现有凭据未覆盖。');
    const profile = { id, name: clean(name || id).slice(0, 80), type: 'api', url: parsed.toString().replace(/\/$/, ''), model: clean(model) || null, key: key.trim() };
    registry.profiles[id] = profile;
    const plan = this.registryPlan(registry, 'add-profile');
    const result = await this.apply(plan);
    return { ...result, profile: safeProfile(profile) };
  }

  async importOfficial({ id = 'official', name = '官方 ChatGPT 账号', file } = {}) {
    this.validateProfileId(id);
    const source = file ? path.resolve(file) : path.join(this.home, 'auth.json');
    assertRegular(source);
    const auth = readJson(source, null);
    if (!isOfficial(auth)) throw new Error('没有找到官方 ChatGPT 登录凭据。请先在服务器完成官方登录，或用 --file 指定已有官方 auth.json；本工具不执行登录或刷新 Token。');
    const registry = this.registry(); const config = loadConfig(this.home);
    if (registry.profiles[id] && registry.profiles[id].type !== 'official') throw new Error('该 ID 已被中转配置使用，未覆盖。');
    const profile = { id, name: clean(name).slice(0, 80) || id, type: 'official', model: config.data.model ?? null, auth };
    registry.profiles[id] = profile;
    return { ...await this.apply(this.registryPlan(registry, 'import-official')), profile: safeProfile(profile) };
  }

  registryPlan(registry, kind) {
    return { kind, target: null, files: this.changes([{ relative: '.cockpit-terminal/registry.json', kind: 'text', before: registry[registrySnapshot], after: jsonBytes(registry) }]), database: null, rows: [], warnings: [] };
  }

  changes(items) {
    return items.map(item => ({ ...item, before: Object.hasOwn(item, 'before') ? item.before : readOptional(path.join(this.home, item.relative)) })).filter(item => !equal(item.before, item.after));
  }

  makeSyncPlan(provider, config, { kind = 'sync', files = [], target = provider, configBytes } = {}) {
    const sessions = scanSessions(this.home); const database = this.dbFile(config); const allRows = databaseRows(database);
    const patches = sessions.filter(s => s.provider !== provider).map(s => ({ relative: path.relative(this.home, s.file), kind: 'session', before: s.bytes, after: providerHeader(s, provider) }));
    const rows = allRows.filter(row => row.provider !== provider).map(row => ({ id: row.id, before: row.provider, after: provider }));
    const warnings = ['仅同步 Provider 标记和聊天索引，不改变历史模型、正文或加密内容；中转兼容性及跨账号解密仍需实际验证。'];
    if (!database) warnings.push('没有 SQLite 索引，本次只更新会话文件。');
    return {
      kind, target, files: [...files, ...patches], database, rows, warnings,
      sessionFingerprint: this.sessionFingerprint(sessions),
      databaseFingerprint: hash(JSON.stringify(allRows)),
      dependencies: [{ relative: 'config.toml', before: configBytes ?? null }]
    };
  }

  sessionFingerprint(sessions) { return hash(JSON.stringify(sessions.map(s => [s.file, hash(s.bytes), s.stamp]))); }

  buildSwitch(id) {
    if (id === 'openai') id = 'official';
    const config = loadConfig(this.home); assertNoProfileOverrides(config.data);
    const registry = this.registry(); const authBytes = readOptional(path.join(this.home, 'auth.json')); let auth;
    try { auth = authBytes ? JSON.parse(authBytes.toString('utf8')) : null; } catch { throw new Error('auth.json 格式无效，未进行任何切换。'); }
    if (isOfficial(auth)) {
      const matching = Object.values(registry.profiles).find(p => p.type === 'official' && sameAccount(p.auth, auth));
      // An explicit import may represent a different account from the one currently logged in.
      // Save that live account under its own ID rather than overwriting the selected import.
      const officialId = matching?.id ?? (!registry.profiles.official ? 'official' : `official-${hash(auth.tokens.account_id ?? auth.tokens.refresh_token ?? auth.tokens.access_token).slice(0, 10)}`);
      registry.profiles[officialId] = { id: officialId, name: registry.profiles[officialId]?.name ?? '官方 ChatGPT 账号', type: 'official', model: config.data.model ?? null, auth };
    }
    if (registry.active && registry.profiles[registry.active]?.type === 'api' && config.data.model_provider === API_PROVIDER && auth?.OPENAI_API_KEY) {
      registry.profiles[registry.active].key = auth.OPENAI_API_KEY;
    }
    const profile = registry.profiles[id];
    if (!profile) throw new Error(`未保存这个账号：${clean(id)}。请先添加中转，或导入官方登录。`);
    if (profile.type === 'official' && !isOfficial(profile.auth)) throw new Error('保存的官方登录无效，请重新导入。');
    if (profile.type === 'api' && !profile.key) throw new Error('中转缺少 API Key，请重新添加。');
    if (profile.type === 'official' && this.env.OPENAI_BASE_URL) throw new Error('当前终端设置了 OPENAI_BASE_URL，可能将官方请求导向中转；请先清除覆盖并检查远程插件环境。');
    const provider = profile.type === 'api' ? API_PROVIDER : 'openai';
    const changes = { model_provider: provider, cli_auth_credentials_store: 'file', openai_base_url: undefined };
    if (profile.model) changes.model = profile.model;
    if (Object.hasOwn(config.data, 'forced_login_method')) changes.forced_login_method = profile.type === 'api' ? 'api' : 'chatgpt';
    const updatedConfig = editConfig(config.text, changes, profile.type === 'api' ? profile : null);
    const targetAuth = profile.type === 'api' ? { auth_mode: 'apikey', OPENAI_API_KEY: profile.key } : profile.auth;
    registry.active = id;
    const files = this.changes([
      { relative: 'config.toml', kind: 'text', before: config.bytes, after: Buffer.from(updatedConfig) },
      { relative: 'auth.json', kind: 'text', before: authBytes, after: jsonBytes(targetAuth) },
      { relative: '.cockpit-terminal/registry.json', kind: 'text', before: registry[registrySnapshot], after: jsonBytes(registry) }
    ]);
    return this.makeSyncPlan(provider, config.data, { kind: 'switch', target: id, files, configBytes: config.bytes });
  }

  summary(plan) {
    return { operation: plan.kind, target: plan.target, sessions: plan.files.filter(f => f.kind === 'session').length, databaseRows: plan.rows.length, configFiles: plan.files.filter(f => f.kind === 'text').map(f => f.relative), database: plan.database, warnings: plan.warnings, noop: !plan.files.length && !plan.rows.length, token: this.planToken(plan) };
  }

  planToken(plan) {
    return hash(JSON.stringify({ kind: plan.kind, target: plan.target, files: plan.files.map(f => [f.relative, hash(f.before), hash(f.after)]), rows: plan.rows, sessions: plan.sessionFingerprint, databasePath: plan.database, database: plan.databaseFingerprint, dependencies: (plan.dependencies ?? []).map(d => [d.relative, hash(d.before)]) }));
  }
  verifyPreview(plan, expectedToken) {
    if (expectedToken && this.planToken(plan) !== expectedToken) throw new Error('预览已过期：配置或会话发生变化，请刷新后重新确认。');
  }

  async previewSwitch(id) { return this.summary(this.buildSwitch(id)); }
  async switchTo(id, { dryRun = false, expectedToken } = {}) {
    const plan = this.buildSwitch(id); this.verifyPreview(plan, expectedToken); return dryRun ? { ...this.summary(plan), dryRun: true } : this.apply(plan);
  }

  buildSync() {
    const config = loadConfig(this.home); assertNoProfileOverrides(config.data);
    const provider = config.data.model_provider ?? 'openai';
    if (provider !== 'openai' && !config.data.model_providers?.[provider]) throw new Error('当前 model_provider 未在配置中定义，未同步历史。');
    return this.makeSyncPlan(provider, config.data, { configBytes: config.bytes });
  }
  async previewSync() { return this.summary(this.buildSync()); }
  async sync({ dryRun = false, expectedToken } = {}) { const plan = this.buildSync(); this.verifyPreview(plan, expectedToken); return dryRun ? { ...this.summary(plan), dryRun: true } : this.apply(plan); }

  safeTarget(relative, kind) {
    if (typeof relative !== 'string' || !inside(this.home, path.join(this.home, relative))) throw new Error('备份包含越界文件路径，拒绝恢复。');
    const normalized = relative.split(path.sep).join('/');
    const allowed = kind === 'session' ? /^(sessions|archived_sessions)\/.+\.jsonl$/.test(normalized) : ['config.toml', 'auth.json', '.cockpit-terminal/registry.json'].includes(normalized);
    if (!allowed) throw new Error('备份包含不受支持的目标路径。');
    const file = path.join(this.home, relative);
    let parent = path.dirname(file);
    while (parent !== this.home) {
      if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) throw new Error('目标目录含符号链接，拒绝恢复。');
      const next = path.dirname(parent); if (next === parent) throw new Error('文件路径越界。'); parent = next;
    }
    assertRegular(file); return file;
  }

  validatePlanFiles(plan) {
    for (const dependency of plan.dependencies ?? []) {
      const file = this.safeTarget(dependency.relative, 'text');
      if (!equal(readOptional(file), dependency.before)) throw new Error(`配置依赖在预检后发生变化：${dependency.relative}`);
    }
    for (const item of plan.files) {
      const file = this.safeTarget(item.relative, item.kind);
      const current = item.kind === 'session' ? readHeader(file).bytes : readOptional(file);
      if (!equal(current, item.before)) throw new Error(`文件在预检后发生冲突：${item.relative}`);
    }
  }

  async apply(plan, { recovery = false } = {}) {
    const release = operationLock(this.state, { recovery });
    let db = null; let committed = false; let journal = null; let previousJournal = null; const applied = [];
    try {
      previousJournal = recovery ? readOptional(this.journalPath) : null;
      if (recovery && plan.kind === 'recover') {
        const current = previousJournal ? JSON.parse(previousJournal.toString('utf8')) : null;
        if (!current || (current.recoveryOf ?? current.backupId) !== plan.target) throw new Error('恢复日志已变化，请重新运行 recover；保留新的中断操作日志。');
      }
      if (!recovery && fs.existsSync(this.journalPath)) throw new Error('发现中断的操作，请先运行 recover；没有修改现有配置。');
      if (plan.files.some(f => f.kind === 'session') || ['switch', 'sync', 'restore', 'recover'].includes(plan.kind)) checkWriterLocks(this.home);
      this.validatePlanFiles(plan);
      if (plan.sessionFingerprint && this.sessionFingerprint(scanSessions(this.home)) !== plan.sessionFingerprint) throw new Error('会话在预检后发生变化，请重试。');
      db = beginDatabase(plan.database, plan.rows);
      if (db && plan.databaseFingerprint) {
        const actual = db.prepare('SELECT id, model_provider FROM threads').all().map(row => ({ id: row.id, provider: row.model_provider }));
        if (hash(JSON.stringify(actual)) !== plan.databaseFingerprint) throw new Error('数据库在预检后发生变化，请重试。');
      }
      if (!plan.files.length && !plan.rows.length) {
        if (recovery && fs.existsSync(this.journalPath)) fs.unlinkSync(this.journalPath);
        return { ...this.summary(plan), noop: true, backupId: null };
      }
      const backupId = new Date().toISOString().replace(/\D/g, '') + '-' + crypto.randomUUID().slice(0, 8);
      const backupDir = path.join(this.backupRoot, backupId); privateDir(this.backupRoot); privateDir(backupDir);
      const manifest = { schema: 1, home: this.home, backupId, createdAt: new Date().toISOString(), operation: plan.kind, target: plan.target, outcome: 'prepared', database: plan.database, rows: plan.rows, files: plan.files.map(f => ({ relative: f.relative, kind: f.kind, before: encode(f.before), after: encode(f.after) })) };
      if (previousJournal) {
        const previous = JSON.parse(previousJournal.toString('utf8'));
        manifest.recoveryOf = previous.recoveryOf ?? previous.backupId;
      }
      atomicWrite(path.join(backupDir, 'manifest.json'), jsonBytes(manifest));
      journal = manifest; atomicWrite(this.journalPath, jsonBytes(journal));
      updateDatabase(db, plan.rows);
      for (const item of plan.files) {
        const file = this.safeTarget(item.relative, item.kind);
        if (item.kind === 'session') await replaceHeader(file, item.before, item.after);
        else {
          if (!equal(readOptional(file), item.before)) throw new Error(`文件写入前发生冲突：${item.relative}`);
          atomicWrite(file, item.after);
        }
        applied.push(item);
      }
      if (db) db.exec('COMMIT'); committed = true;
      manifest.outcome = 'committed'; atomicWrite(path.join(backupDir, 'manifest.json'), jsonBytes(manifest));
      fs.unlinkSync(this.journalPath);
      return { ...this.summary(plan), backupId, noop: false };
    } catch (e) {
      if (committed) throw new Error('数据已写入，但清理操作未完成。请运行 status 和 recover 检查，不要重复切换。');
      let rollbackError;
      if (db) { try { db.exec('ROLLBACK'); } catch (err) { rollbackError = err; } }
      for (const item of applied.reverse()) {
        try {
          const file = this.safeTarget(item.relative, item.kind);
          if (item.kind === 'session') await replaceHeader(file, item.after, item.before);
          else if (equal(readOptional(file), item.after)) atomicWrite(file, item.before);
          else throw new Error('回滚时检测到外部文件修改。');
        } catch (err) { rollbackError = err; }
      }
      if (journal && !rollbackError) {
        journal.outcome = 'rolled-back'; atomicWrite(path.join(this.backupRoot, journal.backupId, 'manifest.json'), jsonBytes(journal));
        if (previousJournal) atomicWrite(this.journalPath, previousJournal);
        else if (fs.existsSync(this.journalPath)) fs.unlinkSync(this.journalPath);
      }
      if (rollbackError) throw new Error('操作失败且自动回滚不完整；备份和恢复日志已保留，请运行 recover。');
      throw e;
    } finally {
      if (db) { try { db.close(); } catch {} }
      release();
    }
  }

  async backups() {
    if (!fs.existsSync(this.backupRoot)) return [];
    const result = [];
    for (const entry of fs.readdirSync(this.backupRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !backupPattern.test(entry.name)) continue;
      const manifest = readJson(path.join(this.backupRoot, entry.name, 'manifest.json'), null);
      if (manifest?.schema !== 1 || manifest.home !== this.home) continue;
      result.push({ id: entry.name, createdAt: manifest.createdAt, operation: manifest.operation, target: manifest.target, outcome: manifest.outcome, sessions: manifest.files?.filter(f => f.kind === 'session').length ?? 0, databaseRows: manifest.rows?.length ?? 0 });
    }
    return result.sort((a, b) => b.id.localeCompare(a.id));
  }

  loadManifest(id) {
    if (!backupPattern.test(id ?? '')) throw new Error('备份 ID 无效；请先运行 backups 获取实际 ID。');
    const dir = path.join(this.backupRoot, id);
    if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new Error('备份目录不能是符号链接。');
    const manifest = readJson(path.join(dir, 'manifest.json'), null);
    if (!manifest || manifest.schema !== 1 || manifest.home !== this.home || manifest.backupId !== id || !Array.isArray(manifest.files) || !Array.isArray(manifest.rows)) throw new Error('备份不存在，或不属于当前 Codex Home。');
    return manifest;
  }

  reverseManifest(manifest, { recovery = false } = {}) {
    const files = [];
    for (const entry of manifest.files) {
      const file = this.safeTarget(entry.relative, entry.kind);
      const current = entry.kind === 'session' ? readHeader(file).bytes : readOptional(file);
      const original = decode(entry.before); const changed = decode(entry.after);
      if (recovery && equal(current, original)) continue;
      if (!equal(current, changed)) throw new Error(`恢复冲突：${entry.relative} 已被其他操作修改，未覆盖。`);
      if (!equal(current, original)) files.push({ relative: entry.relative, kind: entry.kind, before: current, after: original });
    }
    let rows = [];
    if (manifest.database && manifest.rows.length) {
      const config = loadConfig(this.home);
      if (path.resolve(this.dbFile(config.data) ?? '') !== path.resolve(manifest.database)) throw new Error('备份的 SQLite 路径与当前配置不一致，拒绝恢复其他数据库。');
      const current = new Map(databaseRows(manifest.database).map(row => [row.id, row.provider]));
      for (const entry of manifest.rows) {
        const value = current.get(entry.id);
        if (recovery && value === entry.before) continue;
        if (value !== entry.after) throw new Error(`数据库恢复冲突：${entry.id} 已变化，未覆盖。`);
        rows.push({ id: entry.id, before: value, after: entry.before });
      }
    }
    return { kind: recovery ? 'recover' : 'restore', target: manifest.backupId, files, database: manifest.database, rows, dependencies: [{ relative: 'config.toml', before: readOptional(path.join(this.home, 'config.toml')) }], warnings: ['恢复只调整备份记录的元数据；切换后的新增消息和新聊天保持不变。'] };
  }

  async previewRestore(id) { return this.summary(this.reverseManifest(this.loadManifest(id))); }
  async restore(id, { dryRun = false, expectedToken } = {}) {
    const plan = this.reverseManifest(this.loadManifest(id)); this.verifyPreview(plan, expectedToken); return dryRun ? { ...this.summary(plan), dryRun: true } : this.apply(plan);
  }

  async recover({ dryRun = false, expectedToken } = {}) {
    const journal = readJson(this.journalPath, null);
    if (!journal) {
      if (dryRun) return { operation: 'recover', noop: true, dryRun: true };
      const release = operationLock(this.state, { recovery: true });
      try { if (fs.existsSync(this.journalPath)) throw new Error('恢复日志在检查期间发生变化，请重新运行 recover。'); }
      finally { release(); }
      return { operation: 'recover', noop: true };
    }
    // Every retry converges to the original operation's preimage, including crashes
    // while recovering; never interpret the inverse-of-a-recovery as the root operation.
    const manifest = this.loadManifest(journal.recoveryOf ?? journal.backupId);
    const plan = this.reverseManifest(manifest, { recovery: true });
    this.verifyPreview(plan, expectedToken);
    if (dryRun) return { ...this.summary(plan), dryRun: true };
    const result = await this.apply(plan, { recovery: true });
    return result;
  }
}
