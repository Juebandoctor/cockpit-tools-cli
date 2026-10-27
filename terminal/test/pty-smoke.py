#!/usr/bin/env python3
"""Real Linux pseudo-terminal acceptance test; only synthetic temporary Codex data."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import sqlite3
import struct
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser()
parser.add_argument('--node', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
artifacts = root / '.test-artifacts'
artifacts.mkdir(exist_ok=True)
transcript = bytearray()
checks = []

with tempfile.TemporaryDirectory(prefix='cockpit-pty-') as directory:
    home = Path(directory)
    official = {'auth_mode': 'chatgpt', 'tokens': {'access_token': 'synthetic-pty-access', 'refresh_token': 'synthetic-pty-refresh', 'account_id': 'synthetic-pty-account'}}
    (home / 'auth.json').write_text(json.dumps(official), encoding='utf8')
    (home / 'config.toml').write_text('# PTY test only\nmodel = "official-test-model"\n', encoding='utf8')
    (home / 'sessions').mkdir()
    session = home / 'sessions' / 'rollout-pty.jsonl'
    body = '{"type":"event_msg","payload":{"message":"测试聊天正文不变"}}\n'
    session.write_text(json.dumps({'type': 'session_meta', 'payload': {'id': 'pty-thread', 'model_provider': 'openai', 'model': 'historic-test-model'}}) + '\n' + body, encoding='utf8')
    with sqlite3.connect(home / 'state_5.sqlite') as db:
        db.execute('CREATE TABLE threads(id TEXT PRIMARY KEY,model_provider TEXT,title TEXT)')
        db.execute('INSERT INTO threads VALUES(?,?,?)', ('pty-thread', 'openai', 'PTY test'))
    master, slave = pty.openpty()
    fcntl.ioctl(slave, 0x5414, struct.pack('HHHH', 32, 120, 0, 0))
    env = dict(os.environ, TERM='xterm-256color', OPENAI_BASE_URL='', NODE_NO_WARNINGS='1')
    process = subprocess.Popen([args.node, str(root / 'bin' / 'cockpit-terminal.mjs'), '--codex-home', str(home)], stdin=slave, stdout=slave, stderr=slave, env=env, start_new_session=True)
    os.close(slave)

    def receive_until(needle, offset=0, timeout=8):
        expected = needle.encode('utf8')
        until = time.monotonic() + timeout
        while time.monotonic() < until:
            if expected in transcript[offset:]:
                return
            ready, _, _ = select.select([master], [], [], 0.1)
            if ready:
                try:
                    chunk = os.read(master, 131072)
                except OSError:
                    break
                if not chunk:
                    break
                transcript.extend(chunk)
            if process.poll() is not None:
                break
        raise AssertionError(f'Terminal did not show {needle!r}; tail={bytes(transcript[-1600:]).decode("utf8", "replace")}')

    def send(keys, expect=None):
        offset = len(transcript)
        os.write(master, keys.encode('utf8'))
        if expect:
            receive_until(expect, offset)

    try:
        receive_until('COCKPIT TERMINAL')
        checks.append('native Linux TTY startup')
        send('2', '选择账号 / 中转')
        send('a', '添加中转 API')
        for value in ['relay', '测试中转', 'https://relay.example.invalid/v1', 'relay-test-model', 'pty-secret-never-show']:
            os.write(master, (value + '\r').encode('utf8'))
        receive_until('已保存')
        assert b'pty-secret-never-show' not in transcript
        checks.append('API form saves credentials without terminal disclosure')
        send('\x1b[B\r', 'Y 确认执行')
        send('n', '已取消')
        assert json.loads((home / 'auth.json').read_text()) == official
        checks.append('cancel leaves authentication untouched')
        send('\r', 'Y 确认执行')
        send('y', '完成 · 备份')
        assert json.loads((home / 'auth.json').read_text())['OPENAI_API_KEY'] == 'pty-secret-never-show'
        assert 'model_provider = "cockpit_terminal_api"' in (home / 'config.toml').read_text()
        with sqlite3.connect(home / 'state_5.sqlite') as db:
            assert db.execute('SELECT model_provider FROM threads').fetchone()[0] == 'cockpit_terminal_api'
        assert session.read_text().split('\n', 1)[1] == body
        checks.append('confirmed API switch updates config/auth/JSONL/SQLite')
        send('\x1b[A\r', 'Y 确认执行')
        send('y', '完成 · 备份')
        assert json.loads((home / 'auth.json').read_text()) == official
        checks.append('official account round trip from dashboard')
        send('b', '备份记录')
        send('\r', 'Y 确认执行')
        send('y', '完成 · 备份')
        assert json.loads((home / 'auth.json').read_text())['auth_mode'] == 'apikey'
        checks.append('backup restoration from dashboard')
        send('s', 'Y 确认执行')
        send('n', '已取消')
        checks.append('sync preview and cancellation')
        frame_start = len(transcript)
        send('2', '选择账号 / 中转')
        receive_until('原聊天', frame_start)
        current = bytes(transcript).split(b'\x1b[H\x1b[2J')[-1].decode('utf8', 'replace')
        current = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', current)
        (artifacts / 'dashboard.txt').write_text(current, encoding='utf8')
        offset = len(transcript)
        fcntl.ioctl(master, 0x5414, struct.pack('HHHH', 18, 48, 0, 0))
        process.send_signal(signal.SIGWINCH)
        receive_until('COCKPIT TERMINAL', offset)
        checks.append('SSH terminal resize to 48x18')
        send('q')
        assert process.wait(timeout=5) == 0
        # Drain final alternate-screen/cursor cleanup bytes.
        while select.select([master], [], [], 0.05)[0]:
            try:
                data = os.read(master, 131072)
                if not data:
                    break
                transcript.extend(data)
            except OSError:
                break
        assert b'\x1b[?25h\x1b[?1049l' in transcript
        assert b'pty-secret-never-show' not in transcript
        checks.append('clean exit restores cursor and main terminal screen')
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        os.close(master)

report = {'ok': True, 'checks': checks, 'runtime': subprocess.check_output([args.node, '--version'], text=True).strip(), 'platform': 'WSL Ubuntu 22.04 / native Linux PTY', 'realCredentialsUsed': False, 'modelRequestsSent': 0}
(artifacts / 'pty-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps(report, ensure_ascii=False, indent=2))
