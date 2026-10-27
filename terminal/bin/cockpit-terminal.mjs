#!/usr/bin/env node
const help = `Cockpit Tools Terminal — Codex 官方 / 中转 API 管理\n\n用法：cockpit-terminal [命令] [参数]\n\n  tui                         打开终端面板（默认）\n  status                      只读检查当前配置和存储位置\n  profile list                列出账号和中转\n  profile add <id>             添加中转，使用 --url --model --key-env\n  account import [id]          保存现有官方 auth.json\n  switch <id>                 切换账号 / 中转并同步会话\n  sync                        同步历史 provider 和 SQLite 索引\n  backups                     列出备份\n  restore <backup-id>          恢复配置与历史元数据，保留新增消息\n  recover                     恢复上次中断的操作\n\n通用参数：--codex-home PATH  --sqlite-home PATH  --dry-run  --json\n其他参数：--name NAME --url URL --model MODEL --key-env ENV --file PATH\n使用前先退出正在写入该会话的任务；切换后在 VS Code Reload Window。\n`;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(help);
} else {
  const { main } = await import('../src/cli.mjs');
  await main(process.argv.slice(2), help);
}
