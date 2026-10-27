# Cockpit Tools CLI

面向 Linux 服务器、WSL 和 VS Code Remote-SSH 的 Codex 终端工具。

提供全屏终端面板和脚本化 CLI，首版支持 **官方账号 / 中转 API 切换、会话同步、切换备份与恢复**。在同一台服务器的同一个 Codex Home 中切换时，自动同步会话 Provider 元数据和 SQLite 索引，减少手动搬运聊天记录。

## 下载运行

要求 **Node.js >=22.16.0**，推荐 Node 24。便携包包含全部 JavaScript 依赖，解压后不需要 `npm install`，不需要图形桌面、Tauri、GTK 或编译环境。

在服务器的交互终端运行：

```bash
curl -fL https://github.com/Juebandoctor/cockpit-tools-cli/releases/download/cli-v0.1.0/cockpit-tools-cli-0.1.0-portable.tar.gz -o cockpit-cli.tar.gz
tar -xzf cockpit-cli.tar.gz
cd cockpit-tools-terminal
node bin/cockpit-terminal.mjs
```

其他格式与校验文件见 [Releases](https://github.com/Juebandoctor/cockpit-tools-cli/releases)。普通 SSH 直接启动交互面板时使用 `ssh -t`；非交互环境可运行 `--help` 或 `status --json`。

可选：使用发布的 npm 安装包建立全局命令（需要 npm 联网安装依赖，尚未发布到 npm registry）：

```bash
npm install -g https://github.com/Juebandoctor/cockpit-tools-cli/releases/download/cli-v0.1.0/cockpit-tools-terminal-0.1.0.tgz
cockpit-terminal
```

## 首次切换

1. 在服务器运行，确认工具与远程 Codex 插件使用同一个 `CODEX_HOME`，默认 `~/.codex`。自定义路径可加 `--codex-home /实际路径/.codex`。
2. 先正常结束正在执行的 Codex 任务，释放会话占用。有 writer lock 或 SQLite busy 提示时，关闭相关插件会话后重试。
3. 在面板按 **I** 保存现有官方文件登录；也可在首次切到 API 时自动保存当前有效的官方登录。
4. 按 **A** 添加中转：填写 ID、名称、Base URL、模型和 API Key。Key 隐藏输入；添加时只保存配置。
5. 在“账号 / 中转”页选中目标，按 **Enter** 预览，再按 **Y** 切换。切换包含认证、配置、会话 metadata 和 SQLite 索引同步，并自动生成修改前备份。
6. 在 VS Code 执行 **Developer: Reload Window**，从历史列表打开原聊天。需要切回官方时，选择已保存的官方账号，重复切换与重载。

工具不会自动重启 VS Code。若官方凭据只存放在系统 keyring，需要先由官方 Codex 生成文件凭据，或导入已有官方 `auth.json`；本工具不实现 OAuth 登录和 Token 刷新。

## 面板快捷键

| 按键 | 操作 |
| --- | --- |
| `1` / `2` / `3` / `4`，`Tab` | 总览、账号 / 中转、会话同步、备份 / 恢复 |
| `↑` / `↓`，`Enter` | 选择，预览切换或恢复 |
| `Y`；`N` / `Esc` | 确认；取消 |
| `A` / `I` | 添加中转 / 保存官方登录 |
| `S` / `B` / `C` | 同步会话 / 备份列表 / 中断恢复 |
| `F5` / `Q` | 刷新 / 退出 |

面板至少需要 48 列 × 16 行，推荐 100 列 × 30 行。

## 命令行

下列示例使用全局安装后的 `cockpit-terminal`；便携包用户可替换为 `node bin/cockpit-terminal.mjs`。

```bash
cockpit-terminal status --json
cockpit-terminal profile list
cockpit-terminal account import official --name '官方账号'

# API Key 不写入命令行参数与 shell 历史
read -rsp 'API Key: ' COCKPIT_RELAY_KEY; printf '\n'
export COCKPIT_RELAY_KEY
cockpit-terminal profile add relay --name '我的中转' \
  --url https://你的中转地址/v1 --model 你的模型名 --key-env COCKPIT_RELAY_KEY
unset COCKPIT_RELAY_KEY

cockpit-terminal switch relay --dry-run
cockpit-terminal switch relay
cockpit-terminal switch official

cockpit-terminal sync --dry-run
cockpit-terminal sync
cockpit-terminal backups
cockpit-terminal restore 实际备份ID --dry-run
cockpit-terminal restore 实际备份ID
cockpit-terminal recover --dry-run
cockpit-terminal recover
```

所有数据命令支持 `--json`；CLI 显式执行写命令时不再弹出面板确认。完整选项、路径优先级与恢复机制见 [中文使用文档](terminal/README.zh-CN.md)。

## 会话与备份的边界

- 同步针对同一 Codex Home 中的会话：调整 JSONL 首行的 Provider 元数据和 SQLite `threads.model_provider`，保留会话 ID、历史模型名、消息正文与加密内容；本版不提供跨服务器传输。
- **历史可见不代表跨通道一定能续聊。** 加密上下文、模型差异以及中转的 Responses / 工具调用兼容性仍可能影响续接。本版不保证运行中任务热切换。
- 备份位于 `<Codex Home>/.cockpit-terminal/backups/`，包括本次配置、凭据、会话首行与相关索引行，**不是全部聊天正文或整机备份**。恢复保留切换后新增的消息和会话。
- 账号快照和备份含敏感凭据。Unix 采用目录 `0700` / 文件 `0600` 权限，但未加密，请勿上传或分享 `.cockpit-terminal`。
- 不删除 Codex 的 writer locks，不强制结束插件进程。检测到预览过期、并发写入或恢复冲突时停止，供你检查。

首版仅覆盖 Codex。未移植原桌面版其他平台管理、配额界面或 API 网关功能。

## 从源码运行

```bash
git clone https://github.com/Juebandoctor/cockpit-tools-cli.git
cd cockpit-tools-cli/terminal
npm ci --omit=dev
node bin/cockpit-terminal.mjs
```

**请进入 `terminal/`。** 根目录保留原桌面项目源码，它的 npm 命令不用于构建本终端版。

开发验证：

```bash
npm test
npm run check
python3 test/pty-smoke.py --node "$(command -v node)"
python3 scripts/build-portable.py --output cockpit-tools-cli-0.1.0-portable.tar.gz
```

验证在临时 Codex Home 和合成凭据上进行：WSL Ubuntu 22.04 / Node 24 完成单元与集成测试、真实 PTY 面板操作、打包安装验收。未使用真实用户账号发起模型请求，真实服务器上的登录与历史续聊仍需实际验证。验收范围见 [验证记录](terminal/docs/verification.md)。

## 来源与许可

基于 [jlcodes99/cockpit-tools](https://github.com/jlcodes99/cockpit-tools) 的源码快照 `2cfe5e51314bfc0bf70bdda1ba08aed82c7dc8bf` 新增独立终端模块，保留原项目作者署名与许可。本仓库的终端首版不代表原项目已完成全部功能的 CLI 移植。

遵循 **CC-BY-NC-SA-4.0**，包括署名、非商业使用和相同方式共享要求。详见 [许可全文](https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode) 与 [终端模块声明](terminal/NOTICE.md)。
