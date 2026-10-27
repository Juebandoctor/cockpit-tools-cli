import readline from 'node:readline';
import { stripVTControlCharacters } from 'node:util';
import stringWidth from 'string-width';

const pages = ['总览', '账号 / 中转', '会话同步', '备份 / 恢复'];
const sanitize = value => stripVTControlCharacters(String(value ?? '')).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
const color = (text, code) => process.env.NO_COLOR ? text : `\x1b[${code}m${text}\x1b[0m`;

function fit(text, width) {
  text = sanitize(text); let out = ''; let used = 0;
  for (const char of text) { const w = stringWidth(char); if (used + w > width) break; out += char; used += w; }
  return out + ' '.repeat(Math.max(0, width - used));
}

function windowed(lines, selected, available) {
  if (lines.length <= available) return lines;
  const offset = Math.max(0, Math.min(lines.length - available, selected - Math.floor(available / 2)));
  return lines.slice(offset, offset + available);
}

export function renderDashboard(state, columns = 100, rows = 30) {
  const width = Math.max(1, Math.min(160, columns)); const height = Math.max(1, rows);
  if (width < 48 || height < 16) return ['COCKPIT TERMINAL', '请放大终端至 48 列 × 16 行。', 'Q 退出'].slice(0, height).map(line => fit(line, width)).join('\n');
  const inner = width - 4; const s = state.status;
  const lines = [];
  lines.push(color(fit('  COCKPIT TERMINAL    Codex · Headless Edition  v0.1.0', width), '1;36'));
  lines.push(fit('  ' + pages.map((name, i) => `${state.page === i ? '●' : '○'} ${i + 1} ${name}`).join('   '), width));
  lines.push(fit(`  HOME  ${s?.home ?? '正在读取…'}`, width));
  const frameTop = `┌${'─'.repeat(width - 2)}┐`; const frameBottom = `└${'─'.repeat(width - 2)}┘`;
  lines.push(color(frameTop, '36'));
  const available = height - 10; let content = [];
  if (state.form) {
    content.push(state.form.title, '', 'Enter / Tab 下一项    ↑↓ 选择字段    Esc 取消', '');
    for (let i = 0; i < state.form.fields.length; i++) {
      const f = state.form.fields[i]; const value = f.secret ? '*'.repeat(Math.min(f.value.length, 30)) : f.value;
      content.push(`${i === state.form.index ? '▶' : ' '} ${f.label}: ${value}${i === state.form.index ? '▏' : ''}`);
    }
    content.push('', '最后一项按 Enter 保存；API Key 不显示、不写入日志。');
    content = windowed(content, state.form.index + 4, available);
  } else if (state.confirm) {
    const p = state.confirm.preview;
    content = [state.confirm.title, '', `目标：${p.target ?? '当前 Provider'}`, `会话 metadata：${p.sessions ?? 0} 个`, `SQLite 索引：${p.databaseRows ?? 0} 行`, `配置文件：${p.configFiles?.length ?? 0} 个`, '', '执行前自动备份；保留历史模型与聊天正文。', ...(p.warnings ?? []), '', 'Y 确认执行    N / Esc 取消'];
    content = content.slice(0, available);
    if (!content.some(line => line.startsWith('Y 确认'))) content[content.length - 1] = 'Y 确认执行    N / Esc 取消';
  } else if (!s) content = ['正在读取配置…'];
  else if (state.page === 0) {
    content = ['当前连接', '', `Provider    ${s.current.provider}`, `登录方式    ${s.current.authentication === 'chatgpt' ? '官方 ChatGPT' : s.current.authentication === 'apikey' ? 'API Key' : '尚未登录 / 使用系统凭据'}`, `当前账号    ${s.current.profile ?? '现有 Codex 配置'}`, `模型        ${s.current.model ?? '沿用 Codex 默认'}`, '', `聊天 ${s.sessions.count}  ·  索引 ${s.sessions.databaseRows}  ·  备份 ${s.backups}`, '', 'Tab 切换面板，或按 2 管理账号与中转。', ...(s.pendingRecovery ? ['上次操作中断：按 C 预览恢复。'] : []), ...s.warnings.map(w => `提示：${w}`)];
  } else if (state.page === 1) {
    content = ['选择账号 / 中转后按 Enter 预览切换', ''];
    s.profiles.forEach((p, index) => {
      const active = s.current.profile === p.id || (!s.current.profile && p.id === 'official' && s.current.authentication === 'chatgpt');
      content.push(`${index === state.selection ? '▶' : ' '} ${active ? '●' : '○'} ${p.name}  [${p.type === 'official' ? '官方' : 'API'}] ${p.available ? '' : '未导入'}`, `    ${p.id} · ${p.model ?? '保留当前模型'}${p.url ? ` · ${p.url}` : ''}`);
    });
    if (!s.profiles.length) content.push('尚无账号。A 添加中转，I 保存当前官方登录。');
    content = windowed(content, state.selection * 2 + 2, available);
  } else if (state.page === 2) {
    content = ['会话 Provider 同步', '', `会话文件：${s.sessions.count}`, `SQLite 索引：${s.sessions.databaseRows}`, `数据库：${s.database ?? '未找到'}`, '', '文件中的 Provider 分布：', ...Object.entries(s.sessions.distribution).map(([id, count]) => `  ${id}  ${count} 个`), '', 'S 预览同步到当前 Provider', '只改 metadata / 索引，不修改模型、正文或加密内容。', '兼容性限制可能仍需原 Provider / 原账号。'];
  } else {
    content = ['备份记录（新到旧），Enter 预览恢复', ''];
    state.backups.forEach((b, index) => content.push(`${index === state.selection ? '▶' : ' '} ${b.id}`, `    ${b.operation} · ${b.target ?? '配置'} · ${b.outcome} · 聊天 ${b.sessions}`));
    if (!state.backups.length) content.push('暂无备份；有实际写入时自动创建。');
    content = windowed(content, state.selection * 2 + 2, available);
  }
  for (let i = 0; i < available; i++) lines.push(`│ ${fit(content[i] ?? '', inner)} │`);
  lines.push(color(frameBottom, '36'));
  lines.push(fit(state.busy ? '  正在执行并保存备份，请等待…' : `  ${state.notice || '就绪 · 不需要图形桌面 · 未发起任何联网检查'}`, width));
  lines.push(fit('  ↑↓ 选择  Enter 预览  Tab 面板  A 加中转  I 导入官方', width));
  lines.push(fit('  S 同步  B 备份  C 中断恢复  F5 刷新  Q 退出', width));
  lines.push(fit('  切换后：VS Code → Developer: Reload Window → 原聊天', width));
  return lines.slice(0, height).join('\n');
}

export async function runTui(service) {
  const stdin = process.stdin; const stdout = process.stdout;
  if (!stdin.isTTY || !stdout.isTTY || process.env.TERM === 'dumb') throw new Error('终端面板需要交互式 TTY。SSH 请使用 ssh -t；非交互环境可运行 status --json 等命令。');
  const state = { page: 0, selection: 0, status: null, backups: [], notice: '', busy: false, confirm: null, form: null };
  let stopped = false; let exitRequested = false; let finish;
  const completion = new Promise(resolve => { finish = resolve; });
  const render = () => { if (!stopped) stdout.write('\x1b[H\x1b[2J' + renderDashboard(state, stdout.columns ?? 100, stdout.rows ?? 30)); };
  const refresh = async () => {
    const selected = state.page === 1 ? state.status?.profiles[state.selection]?.id : state.page === 3 ? state.backups[state.selection]?.id : null;
    state.status = await service.status(); state.backups = await service.backups();
    if (selected) {
      const list = state.page === 1 ? state.status.profiles : state.backups;
      const index = list.findIndex(item => item.id === selected);
      state.selection = index >= 0 ? index : Math.max(0, Math.min(state.selection, list.length - 1));
    }
  };
  const stop = () => {
    if (state.busy) { exitRequested = true; return; }
    if (stopped) return; stopped = true;
    stdin.off('keypress', onKey); stdout.off('resize', render);
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    stdin.setRawMode(false); stdin.pause(); stdout.write('\x1b[?25h\x1b[?1049l'); finish();
  };
  async function task(action) {
    state.busy = true; state.notice = ''; render();
    try { return await action(); }
    catch (e) { state.notice = `错误：${sanitize(e.message)}`; }
    finally { state.busy = false; if (exitRequested) stop(); else render(); }
  }
  async function requestConfirm(type, id) {
    const preview = type === 'switch' ? await service.previewSwitch(id) : type === 'restore' ? await service.previewRestore(id) : type === 'recover' ? await service.recover({ dryRun: true }) : await service.previewSync();
    state.confirm = { type, id, title: { switch: '切换账号 / 中转', restore: '恢复备份', sync: '同步会话 Provider', recover: '恢复中断操作' }[type], preview };
    render();
  }
  function addForm() {
    state.form = { type: 'api', title: '添加中转 API', index: 0, fields: [
      { key: 'id', label: 'ID（如 relay）', value: '' }, { key: 'name', label: '显示名称', value: '' },
      { key: 'url', label: 'Base URL（含 /v1）', value: '' }, { key: 'model', label: '模型（留空保留）', value: '' }, { key: 'key', label: 'API Key', value: '', secret: true }
    ] }; render();
  }
  async function formKey(text, key) {
    const f = state.form; const field = f.fields[f.index];
    if (key.name === 'escape') { state.form = null; render(); return; }
    if (key.name === 'tab' || key.name === 'return') {
      if (key.name === 'tab' && key.shift) { f.index = Math.max(0, f.index - 1); render(); return; }
      if (f.index < f.fields.length - 1) { f.index++; render(); return; }
      const values = Object.fromEntries(f.fields.map(item => [item.key, item.value]));
      await task(async () => {
        const result = f.type === 'api' ? await service.addApiProfile(values) : await service.importOfficial(values);
        state.form = null; state.notice = `已保存，尚未切换。备份 ${result.backupId ?? '无需修改'}`; await refresh();
      });
      return;
    }
    if (key.name === 'up' || (key.name === 'tab' && key.shift)) f.index = Math.max(0, f.index - 1);
    else if (key.name === 'down') f.index = Math.min(f.fields.length - 1, f.index + 1);
    else if (key.name === 'backspace' || key.name === 'delete') field.value = [...field.value].slice(0, -1).join('');
    else if (key.ctrl && key.name === 'u') field.value = '';
    else if (text && !key.ctrl && !key.meta && !/[\u0000-\u001f\u007f]/.test(text)) field.value += text;
    render();
  }
  async function handle(text, key = {}) {
    if (state.busy) return;
    if (key.ctrl && key.name === 'c') { stop(); return; }
    if (state.form) { await formKey(text, key); return; }
    const letter = (text ?? '').toLowerCase();
    if (state.confirm) {
      if (key.name === 'escape' || letter === 'n') { state.confirm = null; state.notice = '已取消，未修改文件。'; render(); return; }
      if (letter === 'y') {
        const confirm = state.confirm; state.confirm = null;
        await task(async () => {
          const options = { expectedToken: confirm.preview.token };
          const result = confirm.type === 'switch' ? await service.switchTo(confirm.id, options) : confirm.type === 'restore' ? await service.restore(confirm.id, options) : confirm.type === 'recover' ? await service.recover(options) : await service.sync(options);
          state.notice = result.noop ? '没有需要修改的内容。' : `完成 · 备份 ${result.backupId} · 请在 VS Code Reload Window`;
          await refresh();
        });
      }
      return;
    }
    if (letter === 'q') { stop(); return; }
    if (key.name === 'tab' || key.name === 'right' || key.name === 'left') { state.page = (state.page + ((key.shift || key.name === 'left') ? 3 : 1)) % pages.length; state.selection = 0; }
    else if (/^[1-4]$/.test(letter)) { state.page = Number(letter) - 1; state.selection = 0; }
    else if (key.name === 'up') state.selection = Math.max(0, state.selection - 1);
    else if (key.name === 'down') { const count = state.page === 1 ? state.status.profiles.length : state.page === 3 ? state.backups.length : 1; state.selection = Math.min(Math.max(0, count - 1), state.selection + 1); }
    else if (letter === 'a') addForm();
    else if (letter === 'i') {
      state.form = { type: 'official', title: '保存当前官方登录（不发起网络请求）', index: 0, fields: [{ key: 'id', label: '账号 ID', value: 'official' }, { key: 'name', label: '显示名称', value: '官方 ChatGPT 账号' }] };
    }
    else if (letter === 'b') { state.page = 3; state.selection = 0; }
    else if (letter === 's') await task(() => requestConfirm('sync'));
    else if (letter === 'c') await task(() => requestConfirm('recover'));
    else if (key.name === 'f5') await task(refresh);
    else if (key.name === 'return') {
      const selected = state.page === 1 ? state.status.profiles[state.selection] : state.page === 3 ? state.backups[state.selection] : null;
      if (selected) await task(() => requestConfirm(state.page === 1 ? 'switch' : 'restore', selected.id));
    }
    render();
  }
  function onKey(text, key) { handle(text, key).catch(e => { state.notice = `错误：${sanitize(e.message)}`; render(); }); }
  // Load before entering raw mode so invalid configs never strand the SSH terminal.
  await refresh();
  readline.emitKeypressEvents(stdin); stdin.setRawMode(true); stdin.resume();
  stdin.on('keypress', onKey); stdout.on('resize', render); process.on('SIGINT', stop); process.on('SIGTERM', stop);
  stdout.write('\x1b[?1049h\x1b[?25l'); render();
  try { await completion; } finally { if (!stopped) { state.busy = false; stop(); } }
}
