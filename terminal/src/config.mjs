import { parse } from 'smol-toml';
import fs from 'node:fs';
import path from 'node:path';
import { readOptional } from './files.mjs';

export const API_PROVIDER = 'cockpit_terminal_api';

export function loadConfig(home) {
  const file = path.join(home, 'config.toml');
  const bytes = readOptional(file);
  const text = bytes?.toString('utf8') ?? '';
  try { return { file, bytes, text, data: parse(text) }; }
  catch { throw new Error('config.toml 不是有效 TOML；请先修复配置，未进行任何切换。'); }
}

// Split logical TOML statements, respecting multiline strings, comments and arrays.
// Edits operate on complete statements so unrelated comments and tables stay byte-for-byte intact.
function statements(text) {
  const out = []; let start = 0; let quote = ''; let depth = 0; let comment = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (comment) { if (c !== '\n') continue; comment = false; }
    else if (quote) {
      if (quote === '"""' || quote === "'''") {
        if (text.startsWith(quote, i)) { i += 2; quote = ''; }
        else if (quote === '"""' && c === '\\') i++;
      } else if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = '';
      continue;
    } else if (c === '#') { comment = true; continue; }
    else if (c === '"' || c === "'") { quote = text.startsWith(c.repeat(3), i) ? c.repeat(3) : c; if (quote.length === 3) i += 2; continue; }
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    if (c === '\n' && depth === 0) { out.push({ start, end: i + 1, text: text.slice(start, i + 1) }); start = i + 1; }
  }
  if (start < text.length) out.push({ start, end: text.length, text: text.slice(start) });
  return out;
}

function tablePath(header) {
  try {
    let value = parse(header); const keys = [];
    while (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1) {
      const key = Object.keys(value)[0]; keys.push(key); value = value[key];
    }
    return keys;
  } catch { return []; }
}

export function editConfig(text, changes, apiProfile) {
  const source = parse(text); const parts = statements(text); const replacements = []; const found = new Set(); let appendBlock = '';
  let firstTable = text.length;
  for (const part of parts) {
    if (/^\s*\[/.test(part.text)) { firstTable = Math.min(firstTable, part.start); break; }
    let parsed;
    try { parsed = parse(part.text); } catch { continue; }
    for (const key of Object.keys(parsed)) {
      if (!Object.hasOwn(changes, key)) continue;
      found.add(key);
      // Inline comments are retained for edited scalar values.
      const comment = part.text.match(/(?:"(?:[^"\\]|\\.)*"|'[^']*'|[^#])*?(#[^\r\n]*)(?:\r?\n)?$/)?.[1];
      const newline = part.text.endsWith('\r\n') ? '\r\n' : '\n';
      const replacement = changes[key] === undefined ? (comment ? `${comment}${newline}` : '') : `${key} = ${JSON.stringify(changes[key])}${comment ? ` ${comment}` : ''}${newline}`;
      replacements.push({ start: part.start, end: part.end, text: replacement });
    }
  }
  const additions = Object.entries(changes).filter(([key, value]) => !found.has(key) && value !== undefined).map(([key, value]) => `${key} = ${JSON.stringify(value)}\n`).join('');
  if (additions) replacements.push({ start: firstTable, end: firstTable, text: `${firstTable && text[firstTable - 1] !== '\n' ? '\n' : ''}${additions}\n` });
  if (apiProfile) {
    const block = `[model_providers.${API_PROVIDER}]\nname = ${JSON.stringify(apiProfile.name)}\nbase_url = ${JSON.stringify(apiProfile.url)}\nwire_api = "responses"\nrequires_openai_auth = true\n`;
    let match = null;
    for (let i = 0; i < parts.length; i++) {
      if (!/^\s*\[/.test(parts[i].text)) continue;
      const keys = tablePath(parts[i].text);
      if (keys.length === 2 && keys[0] === 'model_providers' && keys[1] === API_PROVIDER) {
        let end = text.length;
        for (let j = i + 1; j < parts.length; j++) { if (/^\s*\[/.test(parts[j].text)) { end = parts[j].start; break; } }
        match = { start: parts[i].start, end, text: block + '\n' }; break;
      }
    }
    if (match) replacements.push(match);
    else appendBlock = block;
  }
  replacements.sort((a, b) => b.start - a.start || b.end - a.end);
  let result = text;
  for (const r of replacements) result = result.slice(0, r.start) + r.text + result.slice(r.end);
  if (appendBlock) result += `${result.endsWith('\n') || !result ? '\n' : '\n\n'}${appendBlock}`;
  try { parse(result); } catch { throw new Error('配置包含无法安全增量编辑的 TOML 表结构；保留原文件并停止。'); }
  for (const [key, value] of Object.entries(source)) {
    if (!Object.hasOwn(changes, key) && key !== 'model_providers' && JSON.stringify(parse(result)[key]) !== JSON.stringify(value)) throw new Error(`拒绝修改无关配置：${key}`);
  }
  return result;
}

export function assertNoProfileOverrides(config) {
  const selected = config.profile;
  if (!selected) return;
  const profile = config.profiles?.[selected];
  if (profile && ['model_provider', 'model', 'openai_base_url', 'cli_auth_credentials_store', 'forced_login_method'].some(key => Object.hasOwn(profile, key))) {
    throw new Error(`配置档 profile=${selected} 覆盖了根配置；请先在 Codex 设置中取消该配置档，避免切换无效。`);
  }
}

export function findDatabase(home, config, explicit, env = process.env) {
  const location = explicit ?? config.sqlite_home ?? env.CODEX_SQLITE_HOME;
  const dirs = location ? [path.resolve(location)] : [path.join(home, 'sqlite'), home];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const candidates = fs.readdirSync(dir).filter(name => /^state(?:_\d+)?\.sqlite$/.test(name));
    candidates.sort((a, b) => Number(b.match(/_(\d+)/)?.[1] ?? 0) - Number(a.match(/_(\d+)/)?.[1] ?? 0));
    if (candidates.length) return path.join(dir, candidates[0]);
  }
  if (location) throw new Error(`指定的 SQLite 目录中没有找到 state_*.sqlite 数据库：${dirs[0]}`);
  return null;
}
