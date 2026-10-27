# Cockpit Tools Terminal — Codex 首版

面向无图形桌面的 Linux 服务器，提供类似 cc-switch-cli 的全屏终端面板。第一版只覆盖 **Codex 官方账号 / 中转 API 切换、会话同步、备份与恢复**，适配在 VS Code Remote-SSH 中使用 Codex 插件的操作流程。

这是原仓库中新增的独立 `terminal/` 模块，不加载 Tauri、GTK 或 WebView。原桌面软件源码保持不变。来源与许可见 [NOTICE.md](NOTICE.md)。

## 安装与打开

要求 **Node.js >=22.16.0**，建议 Node 24 LTS。依赖只有纯 JavaScript TOML 解析和终端字符宽度计算；SQLite 使用 Node 内置模块，不编译原生 npm 扩展。

### 从源码运行

把 `terminal/` 整个目录复制到服务器，在 **远程服务器终端** 中运行：

```bash
cd /你复制到的目录/terminal
npm ci --omit=dev
node bin/cockpit-terminal.mjs
```

### 离线便携包（推荐直接复制到服务器）

Linux / WSL 可直接下载并解压包含依赖的 tar.gz：

```bash
curl -fL https://github.com/Juebandoctor/cockpit-tools-cli/releases/download/cli-v0.1.0/cockpit-tools-cli-0.1.0-portable.tar.gz -o cockpit-cli.tar.gz
tar -xzf cockpit-cli.tar.gz
cd cockpit-tools-terminal
node bin/cockpit-terminal.mjs
```

`cockpit-tools-terminal-0.1.0-portable.zip` 已包含全部纯 JavaScript 依赖，无须在服务器执行 npm 安装；仍然需要 Node.js >=22.16.0。

```bash
unzip cockpit-tools-terminal-0.1.0-portable.zip
cd cockpit-tools-terminal
node bin/cockpit-terminal.mjs
```

### 从本地打包文件安装

发布产物是本地生成的 `cockpit-tools-terminal-0.1.0.tgz`，没有发布到 npm registry。

```bash
npm install -g ./cockpit-tools-terminal-0.1.0.tgz
cockpit-terminal
```

不使用全局目录时：

```bash
npm install --prefix "$HOME/.local/share/cockpit-terminal" ./cockpit-tools-terminal-0.1.0.tgz
node "$HOME/.local/share/cockpit-terminal/node_modules/cockpit-tools-terminal/bin/cockpit-terminal.mjs"
```

普通 SSH 需要交互式终端；如果直接通过 SSH 启动命令，请加 `ssh -t`。默认面板要求至少 48 列 × 16 行，推荐 100 列 × 30 行。非交互环境使用命令行和 `--json`。

## VS Code Remote-SSH 首次使用

1. 在 Codex 插件设置中打开 `config.toml`，确认它位于远程服务器哪个 Codex Home。工具与插件必须操作同一份数据。
2. 在远程终端执行只读检查：

   ```bash
   cockpit-terminal status
   # 自定义位置：
   cockpit-terminal status --codex-home /实际路径/.codex
   ```

3. 正在运行的 Codex 任务先正常结束；在首次迁移/切换前释放原会话占用。如果工具报告 writer lock 或 SQLite busy，先关闭相关插件会话后再试。不要删除 Codex 锁文件，不要运行中的会话与迁移同时写入。
4. 打开面板，按 **I** 保存现有官方登录（可选；从有效官方登录首次切到 API 时也会自动保存）。按 **A** 添加中转的 ID、名称、完整 Base URL、模型和 API Key。添加只保存终端配置，不立即切换。
5. 在“账号 / 中转”页选择目标，Enter 预览，Y 执行。切换包含凭据、配置、JSONL metadata 与 SQLite 索引同步，不需要手动复制会话。
6. 在 VS Code 执行 **Developer: Reload Window**，从插件历史列表打开原聊天并验证续接。

如果原登录保存在系统 keyring 而不是 `auth.json`，工具不会读取系统 keyring。请先用官方 Codex 完成文件凭据登录，或明确导入已有官方文件。工具本身不实现 OAuth、Token 刷新或第三方账号验证，也不会自动结束/重启 VS Code。

## 面板快捷键

| 按键 | 操作 |
| --- | --- |
| 1 / 2 / 3 / 4，Tab / Shift+Tab | 总览、账号/中转、会话同步、备份/恢复 |
| ↑ / ↓ | 选择账号或备份 |
| Enter | 预览选中账号的切换 / 选中备份的恢复 |
| Y；N / Esc | 确认；取消 |
| A | 添加中转，API Key 隐藏输入 |
| I | 将现有官方 `auth.json` 保存为账号快照 |
| S | 预览同步到当前 Provider |
| B | 打开备份页 |
| C | 预览恢复上次中断操作 |
| F5 | 刷新状态 |
| Q / Ctrl+C | 退出并恢复终端；写操作期间等待操作结束 |

输入表单中，Enter / Tab 下一项，↑↓ 选择字段，Backspace 删除，Ctrl+U 清空当前项，Esc 取消。最后一项按 Enter 保存。

## 直接使用命令

```bash
# 不修改任何配置
cockpit-terminal status --json
cockpit-terminal profile list

# 保存目前的官方登录
cockpit-terminal account import official --name '官方账号'
# 或从明确指定的文件导入（不要共享该文件）
cockpit-terminal account import official2 --file /安全路径/auth.json --name '另一个官方账号'

# Key 通过不回显输入提供，避免出现在 shell 历史和进程参数中
read -rsp 'API Key: ' COCKPIT_RELAY_KEY; printf '\n'
export COCKPIT_RELAY_KEY
cockpit-terminal profile add relay --name '我的中转' \
  --url https://你的中转地址/v1 --model 你的模型名 --key-env COCKPIT_RELAY_KEY
unset COCKPIT_RELAY_KEY

# 可先预览；命令行明确执行写操作时不再弹确认
cockpit-terminal switch relay --dry-run
cockpit-terminal switch relay
cockpit-terminal switch official

# 已经由其他工具改过配置，仅同步现有会话
cockpit-terminal sync --dry-run
cockpit-terminal sync

cockpit-terminal backups
cockpit-terminal restore 实际备份ID --dry-run
cockpit-terminal restore 实际备份ID

# 崩溃或被杀掉进程后，先检查，再恢复
cockpit-terminal status
cockpit-terminal recover --dry-run
cockpit-terminal recover
```

也支持 `profile add ... --key-stdin`。**不要把 API Key 直接作为命令参数**。`switch openai` 是 `switch official` 的别名。

所有数据命令支持 `--json`，正常输出为 `{ "ok": true, "result": ... }`；失败输出 `{ "ok": false, "error": ... }` 并退出 1。Node 22 可能把内置 SQLite 的实验性提示写到 stderr，JSON stdout 不受影响。`--help`、`--version` 为普通文本。

## 实际修改范围

- API 模式：使用受管 Provider `cockpit_terminal_api`，配置 Responses API、`requires_openai_auth = true`，把 API Key 写到当前 Home 的 `auth.json`。
- 官方模式：选择内置 `openai`，恢复保存的官方认证；切到中转前保存当前最新的官方文件凭据。不会用当前账号覆盖你明确导入的另一个账号。
- 将根级凭据存储切为 `file`，移除根级 `openai_base_url`；保留其他 Provider、MCP、项目信任配置及无关 TOML 文本。已有 `forced_login_method` 会随目标认证方式调整。原值均进入备份。
- 只调整会话第一行 `session_meta.payload.model_provider` 与 SQLite `threads.model_provider`。历史模型名称、正文、加密数据、会话 ID 和目录均不重写。大文件正文采用流式复制，不整体加载到内存。
- 显式选中的 Codex `profile` 若覆盖根级 Provider/模型/认证，本版会拒绝切换，避免显示成功而插件仍使用旧通道。项目级配置、远程插件进程环境仍需在真实环境核对。

**会话可见不等于一定能跨通道继续。** 原账号绑定的加密上下文，以及中转的模型、Responses 协议或工具调用兼容性，均可能导致续聊失败；本工具不会删除加密内容来强行绕过，也不保证在同一个正在运行的任务中热切换。

## 路径、备份与恢复

- Codex Home：`--codex-home` → `CODEX_HOME` → `~/.codex`。
- SQLite 目录：`--sqlite-home` → 配置根级 `sqlite_home` → `CODEX_SQLITE_HOME` → `<Codex Home>/sqlite`，仅默认布局再回退到 `<Codex Home>`。选择目录中最高数字版本的 `state_*.sqlite`。明确指定目录却没有数据库时停止，不操作另一份索引。
- 终端账号、Key、认证快照：`<Codex Home>/.cockpit-terminal/registry.json`。
- 备份：`<Codex Home>/.cockpit-terminal/backups/<ID>/manifest.json`，包含本次实际修改的配置/认证前后快照、会话首行与索引行。**不是整机或整份聊天正文备份**。
- 未完成操作：`.cockpit-terminal/pending-operation.json`，有该文件时新的写操作会被阻止。
- 进程间排他使用单独 SQLite 事务锁；锁文件仅保存诊断信息。崩溃后内核会释放事务锁，`recover` 可回收已确认死亡进程留下的诊断锁。不要删除 `.cockpit-terminal/operation-lock.sqlite`，不要从 Windows 直接修改 WSL 中正在使用的 SQLite 数据。

认证、终端状态及备份在 Unix 上采用 `0700` 目录和 `0600` 文件权限。备份与认证快照包含可恢复的敏感凭据，本地存储不等于加密，请不要上传或分享 `.cockpit-terminal` 目录。

恢复是**逐项恢复配置及元数据**，不替换整份 SQLite 数据库、不回滚聊天正文；新增消息和新会话保持不变。目标文件已被其他操作修改时停止并提示冲突。有实际写入才创建备份，预览和无改动不创建备份；本版不自动清理旧备份。

## 验证

```bash
npm test
npm run check
# Linux / WSL 原生 PTY 验收，需要 Python 3
python3 test/pty-smoke.py --node "$(command -v node)"
```

源码环境可以用 `python3 scripts/build-portable.py --output /输出路径/cockpit-tools-terminal-0.1.0-portable.zip` 重新生成便携包。便携包仅包含运行文件和依赖，不打包测试临时数据或本机账号。

测试只使用临时 Codex Home、真实 SQLite 测试库和明确的合成凭据。覆盖官方/API 往返、导入不同官方账号、保留新增消息的恢复、SQLite busy、writer lock、预览过期、双进程并发、恢复过程再次崩溃、私有文件权限、终端表单/取消/切换/恢复/缩放/退出。没有读取用户真实认证，也不向模型发送请求。

第一版尚未连接你的真实服务器或真实 Codex 插件账号做端到端认证/续聊验证；这一步仍需在实际服务器完成。
