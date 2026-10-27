import test from 'node:test';
import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import stringWidth from 'string-width';

let renderDashboard;
try { ({ renderDashboard } = await import('../src/tui.mjs')); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }

const state = { page: 1, selection: 0, status: { home: '/tmp/中文/very-long-path-to-the-codex-home', current: { provider: 'openai', authentication: 'chatgpt' }, profiles: [{ id: 'relay', name: '这是很长的中转服务名称', type: 'api', available: true, model: 'test-model', url: 'https://example.invalid/v1' }], sessions: { count: 1, databaseRows: 1, distribution: { openai: 1 } }, warnings: [], backups: 0 }, backups: [], notice: '', busy: false };

test('dashboard fits narrow and normal SSH terminals including double-width Chinese characters', () => {
  assert.equal(typeof renderDashboard, 'function', 'terminal dashboard renderer must exist');
  for (const [columns, rows] of [[48, 18], [80, 24], [120, 32], [30, 12]]) {
    const lines = stripVTControlCharacters(renderDashboard(state, columns, rows)).split('\n');
    assert.ok(lines.length <= rows, `height ${lines.length} > ${rows}`);
    for (const line of lines) assert.ok(stringWidth(line) <= columns, `width exceeded: ${line}`);
  }
});

test('API-key fields are masked in rendered dashboard output', () => {
  assert.equal(typeof renderDashboard, 'function');
  const output = renderDashboard({ ...state, form: { title: '添加中转', fields: [{ label: 'API Key', value: 'never-print-this-test-secret', secret: true }], index: 0 } }, 100, 30);
  assert.doesNotMatch(output, /never-print-this-test-secret/); assert.match(output, /\*\*\*/);
});
