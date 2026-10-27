import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { createService } from './service.mjs';

function human(result) {
  if (Array.isArray(result)) {
    if (!result.length) return '没有记录。';
    return result.map(item => item.id ? `${item.id}  ${item.name ?? item.operation ?? ''}  ${item.type ?? item.outcome ?? ''}  ${item.model ?? item.createdAt ?? ''}` : JSON.stringify(item)).join('\n');
  }
  if (result.current) {
    return [
      'COCKPIT TERMINAL · 只读状态', `Codex Home: ${result.home}`, `SQLite: ${result.database ?? '未找到'}`,
      `当前 Provider: ${result.current.provider}`, `登录方式: ${result.current.authentication}`, `模型: ${result.current.model ?? 'Codex 默认'}`,
      `聊天文件: ${result.sessions.count}  索引行: ${result.sessions.databaseRows}  备份: ${result.backups}`,
      ...result.warnings.map(w => `提示: ${w}`)
    ].join('\n');
  }
  return [
    result.dryRun ? '预览完成，没有修改文件。' : result.noop ? '没有需要修改的内容。' : '操作完成。',
    `操作: ${result.operation}${result.target ? ` → ${result.target}` : ''}`,
    ...(result.sessions !== undefined ? [`会话 metadata: ${result.sessions}  SQLite 索引: ${result.databaseRows}`] : []),
    ...(result.backupId ? [`备份: ${result.backupId}`] : []),
    ...(result.warnings ?? []).map(w => `提示: ${w}`),
    ...(!result.dryRun && ['switch', 'restore', 'recover'].includes(result.operation) ? ['VS Code Remote-SSH：执行 Developer: Reload Window，再打开原聊天验证续接。'] : [])
  ].join('\n');
}

export async function main(args, help) {
  let json = args.includes('--json');
  try {
    const { positionals: p, values: v } = parseArgs({ args, allowPositionals: true, strict: true, options: {
      'codex-home': { type: 'string' }, 'sqlite-home': { type: 'string' },
      'dry-run': { type: 'boolean' }, json: { type: 'boolean' },
      name: { type: 'string' }, url: { type: 'string' }, model: { type: 'string' },
      'key-env': { type: 'string' }, 'key-stdin': { type: 'boolean' }, file: { type: 'string' },
      version: { type: 'boolean' }
    } });
    json = v.json ?? false;
    if (v.version) { process.stdout.write('0.1.0\n'); return; }
    const service = createService({ home: v['codex-home'], sqliteHome: v['sqlite-home'] });
    const options = { dryRun: !!v['dry-run'] };
    const command = p[0] ?? 'tui';
    let result;
    if (command === 'tui') {
      if (json || v['dry-run']) throw new Error('tui 不接受 --json 或 --dry-run，请使用 status / switch / sync。');
      const { runTui } = await import('./tui.mjs'); await runTui(service); return;
    }
    if (command === 'status') result = await service.status();
    else if (command === 'profile' && p[1] === 'list') result = (await service.status()).profiles;
    else if (command === 'profile' && p[1] === 'add') {
      if (v['dry-run']) throw new Error('添加账号不支持 --dry-run；添加只保存终端配置，不切换 Codex。');
      if (v['key-env'] && v['key-stdin']) throw new Error('--key-env 和 --key-stdin 只能选一个。');
      const key = v['key-env'] ? process.env[v['key-env']] : v['key-stdin'] ? fs.readFileSync(0, 'utf8').trim() : null;
      if (!key) throw new Error('请用 --key-env 环境变量名 或 --key-stdin 提供 API Key；也可以在终端面板中输入，不要把 Key 直接放进命令参数。');
      result = await service.addApiProfile({ id: p[2], name: v.name, url: v.url, model: v.model, key });
    } else if (command === 'account' && p[1] === 'import') {
      if (v['dry-run']) throw new Error('导入账号不支持 --dry-run；导入只保存现有官方登录，不切换 Codex。');
      result = await service.importOfficial({ id: p[2] ?? 'official', name: v.name, file: v.file });
    } else if (command === 'switch' && p[1]) result = await service.switchTo(p[1], options);
    else if (command === 'sync') result = await service.sync(options);
    else if (command === 'backups') result = await service.backups();
    else if (command === 'restore' && p[1]) result = await service.restore(p[1], options);
    else if (command === 'recover') result = await service.recover(options);
    else throw new Error('未知命令或缺少参数，请运行 cockpit-terminal --help。');
    process.stdout.write((json ? JSON.stringify({ ok: true, result }) : human(result)) + '\n');
  } catch (e) {
    const message = String(e.message).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
    if (json) process.stdout.write(JSON.stringify({ ok: false, error: message }) + '\n');
    else process.stderr.write(`错误：${message}\n`);
    process.exitCode = 1;
  }
}
