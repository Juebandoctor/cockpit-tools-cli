import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { assertRegular, hash } from './files.mjs';

export function readHeader(file) {
  assertRegular(file);
  const fd = fs.openSync(file, 'r');
  const chunks = []; let size = 0; let newline = false;
  try {
    while (size < 2 * 1024 * 1024) {
      const chunk = Buffer.alloc(Math.min(65536, 2 * 1024 * 1024 - size));
      const read = fs.readSync(fd, chunk, 0, chunk.length, size);
      if (!read) break;
      const end = chunk.subarray(0, read).indexOf(10);
      if (end !== -1) { chunks.push(chunk.subarray(0, end + 1)); size += end + 1; newline = true; break; }
      chunks.push(chunk.subarray(0, read)); size += read;
    }
  } finally { fs.closeSync(fd); }
  const bytes = Buffer.concat(chunks);
  if (!newline && fs.statSync(file).size > bytes.length) throw new Error(`会话 metadata 首行超过 2 MiB，未修改：${file}`);
  let meta;
  try { meta = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error(`会话首行 JSON / UTF-8 metadata 无效：${file}`); }
  if (meta?.type !== 'session_meta' || !meta.payload || typeof meta.payload !== 'object' || Array.isArray(meta.payload)) throw new Error(`会话缺少 session_meta 对象：${file}`);
  const ending = bytes.at(-1) === 10 ? (bytes.at(-2) === 13 ? '\r\n' : '\n') : '';
  return { file, bytes, meta, ending, provider: meta.payload.model_provider ?? 'openai', stamp: fingerprint(file) };
}

function fingerprint(file) { const s = fs.statSync(file, { bigint: true }); return `${s.size}:${s.mtimeNs}:${s.ino}`; }

export function scanSessions(home) {
  const results = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) results.push(readHeader(file));
    }
  }
  for (const folder of ['sessions', 'archived_sessions']) {
    const root = path.join(home, folder);
    if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) throw new Error(`会话目录是符号链接，未进行迁移：${root}`);
    walk(root);
  }
  return results;
}

export function providerHeader(header, provider) {
  const meta = { ...header.meta, payload: { ...header.meta.payload, model_provider: provider } };
  return Buffer.from(JSON.stringify(meta) + header.ending);
}

// Replace the metadata line by streaming the remaining bytes, never parsing or rewriting messages.
export async function replaceHeader(file, expected, replacement) {
  const current = readHeader(file);
  if (hash(current.bytes) !== hash(expected)) throw new Error(`会话 metadata 冲突，未覆盖：${file}`);
  const temporary = path.join(path.dirname(file), `.cockpit-${crypto.randomUUID()}.tmp`);
  let source = fs.openSync(file, 'r');
  let target;
  try {
    target = fs.openSync(temporary, 'wx', fs.statSync(file).mode & 0o777);
    fs.writeFileSync(target, replacement);
    await pipeline(fs.createReadStream(file, { fd: source, autoClose: false, start: current.bytes.length }), fs.createWriteStream(temporary, { fd: target, autoClose: false, start: replacement.length }));
    fs.fsyncSync(target); fs.closeSync(target); target = undefined;
    if (fingerprint(file) !== current.stamp) throw new Error(`会话在操作期间被写入，未覆盖：${file}`);
    // Windows will not replace a destination that this process still holds open.
    fs.closeSync(source); source = undefined;
    fs.renameSync(temporary, file);
  } finally {
    if (source !== undefined) fs.closeSync(source);
    if (target !== undefined) fs.closeSync(target);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
