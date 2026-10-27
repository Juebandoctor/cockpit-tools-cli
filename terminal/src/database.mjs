import { DatabaseSync } from 'node:sqlite';
import { assertRegular } from './files.mjs';

export function databaseRows(file) {
  if (!file) return [];
  assertRegular(file);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const columns = db.prepare('PRAGMA table_info(threads)').all().map(row => row.name);
    if (!columns.includes('id') || !columns.includes('model_provider')) throw new Error('SQLite threads 表结构不支持安全迁移；缺少 id/model_provider，未修改。');
    return db.prepare('SELECT id, model_provider FROM threads').all().map(row => ({ id: row.id, provider: row.model_provider }));
  } finally { db.close(); }
}

export function beginDatabase(file, rows) {
  if (!file || !rows.length) return null;
  assertRegular(file);
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout=150; BEGIN IMMEDIATE');
    const get = db.prepare('SELECT model_provider FROM threads WHERE id = ?');
    for (const row of rows) {
      const current = get.get(row.id);
      if (!current || current.model_provider !== row.before) throw new Error(`数据库 provider 冲突：${row.id}`);
    }
    return db;
  } catch (e) { try { db.exec('ROLLBACK'); } catch {} db.close(); throw e; }
}

export function updateDatabase(db, rows) {
  if (!db) return;
  const statement = db.prepare('UPDATE threads SET model_provider = ? WHERE id = ? AND model_provider IS ?');
  for (const row of rows) {
    const result = statement.run(row.after, row.id, row.before);
    if (Number(result.changes) !== 1) throw new Error(`数据库会话在操作期间变化：${row.id}`);
  }
}
