import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const hash = data => crypto.createHash('sha256').update(data ?? '').digest('hex');
export const encode = data => data === null ? null : Buffer.from(data).toString('base64');
export const decode = data => data === null ? null : Buffer.from(data, 'base64');

export function readOptional(file) {
  try { return fs.readFileSync(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

export function readJson(file, fallback) {
  const data = readOptional(file);
  if (data === null) return fallback;
  try { return JSON.parse(data.toString('utf8')); } catch { throw new Error(`JSON 文件格式错误：${file}`); }
}

export function privateDir(dir) {
  if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new Error(`拒绝操作符号链接：${dir}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(dir, 0o700);
}

export function assertRegular(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`需要普通文件，拒绝操作目录或符号链接：${file}`);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
}

export function atomicWrite(file, data, { mode = 0o600 } = {}) {
  assertRegular(file);
  if (data === null) { if (fs.existsSync(file)) fs.unlinkSync(file); return; }
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', mode);
    fs.writeFileSync(fd, data); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temporary, file);
    if (process.platform !== 'win32') fs.chmodSync(file, mode);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function jsonBytes(data) { return Buffer.from(JSON.stringify(data, null, 2) + '\n'); }

export function inside(root, file) {
  const relative = path.relative(root, path.resolve(file));
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

export function checkWriterLocks(home) {
  const dir = path.join(home, 'thread-writer-locks');
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(dir, entry.name);
    let owner;
    try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('Codex 会话锁无法确认是否已释放；请先结束相关会话，不要删除锁文件。'); }
    const pid = Number(owner.pid ?? owner.process_id ?? owner.processId);
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('Codex 会话锁无法确认；请先退出占用该会话的插件后重试。');
    try { process.kill(pid, 0); throw new Error('Codex 会话正在占用，请先结束任务并释放插件会话后重试。'); }
    catch (e) { if (e.code !== 'ESRCH') throw e; }
  }
}

export function operationLock(stateDir, { recovery = false } = {}) {
  privateDir(stateDir);
  // A kernel-backed SQLite write lock fences all processes, including simultaneous
  // stale-owner recovery. The database file must never be deleted or replaced.
  const guardFile = path.join(stateDir, 'operation-lock.sqlite'); assertRegular(guardFile);
  const guard = new DatabaseSync(guardFile);
  const lock = path.join(stateDir, 'operation.lock');
  try {
    if (process.platform !== 'win32') fs.chmodSync(guardFile, 0o600);
    try { guard.exec('PRAGMA busy_timeout=150; BEGIN IMMEDIATE'); }
    catch { throw new Error('终端管理器正在占用，另一操作尚未结束。'); }
    try { fs.mkdirSync(lock, { mode: 0o700 }); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (!recovery) throw new Error('终端管理器正在占用，或上次操作中断；请检查状态后运行 recover。');
      const owner = readJson(path.join(lock, 'owner.json'), null);
      if (!owner) {
        // A process can die between mkdir and the atomic owner write (or during
        // release). The already-held SQLite guard proves no cooperating writer lives.
        const entries = fs.readdirSync(lock);
        if (entries.some(name => !/^\.owner\.json\.[a-f0-9-]+\.tmp$/.test(name))) throw new Error('操作锁包含无法确认的文件，保留锁并停止恢复。');
        for (const name of entries) { const file = path.join(lock, name); assertRegular(file); fs.unlinkSync(file); }
      } else {
        if (owner.hostname !== os.hostname() || !Number.isInteger(owner.pid)) throw new Error('无法确认操作锁的归属，保留锁并停止恢复。');
        try { process.kill(owner.pid, 0); throw new Error('操作仍在占用，不能恢复正在运行的操作。'); } catch (e2) { if (e2.code !== 'ESRCH') throw e2; }
        fs.unlinkSync(path.join(lock, 'owner.json'));
      }
      fs.rmdirSync(lock); fs.mkdirSync(lock, { mode: 0o700 });
    }
    const nonce = crypto.randomUUID();
    atomicWrite(path.join(lock, 'owner.json'), jsonBytes({ pid: process.pid, hostname: os.hostname(), nonce }));
    return () => {
      try {
        const owner = readJson(path.join(lock, 'owner.json'), null);
        if (owner?.nonce === nonce) { fs.unlinkSync(path.join(lock, 'owner.json')); fs.rmdirSync(lock); }
      } finally { try { guard.exec('ROLLBACK'); } finally { guard.close(); } }
    };
  } catch (e) { try { guard.exec('ROLLBACK'); } catch {} guard.close(); throw e; }
}
