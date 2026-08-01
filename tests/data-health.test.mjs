import assert from 'node:assert/strict';
import test from 'node:test';

import { dataHealthLevel, runDataHealthCheck } from '../src/database/data-health.ts';
import { migrateDatabase } from '../src/database/migrate.ts';
import { createTestDatabase } from './sqlite-test-adapter.mjs';

async function setup() {
  const db = createTestDatabase();
  await migrateDatabase(db);
  return db;
}

test('data health check reports missing referenced media without changing data', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  const now = new Date().toISOString();
  await db.runAsync(
    'INSERT INTO entries (id, content, occurred_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    'entry', '正文', now, now, now,
  );
  await db.runAsync(
    'INSERT INTO entry_images (id, entry_id, uri, created_at, thumbnail_uri) VALUES (?, ?, ?, ?, ?)',
    'image', 'entry', 'file:///exists.jpg', now, 'file:///missing.jpg',
  );

  const report = await runDataHealthCheck(db, (uri) => uri.endsWith('/exists.jpg'));
  assert.equal(report.databaseOk, true);
  assert.equal(report.foreignKeyIssues, 0);
  assert.equal(report.referencedMediaFiles, 2);
  assert.equal(report.missingMediaFiles, 1);
  assert.equal(dataHealthLevel(report, new Date(report.checkedAt)), 'critical');
  assert.equal((await db.getFirstAsync('SELECT COUNT(*) AS count FROM entry_images')).count, 1);
});

test('data health level recommends a backup for existing unexported records', () => {
  const report = {
    checkedAt: '2026-08-01T00:00:00.000Z', databaseOk: true, databaseMessage: '正常',
    foreignKeyIssues: 0, invalidDates: 0, referencedMediaFiles: 0, missingMediaFiles: 0,
    expiredTrashEntries: 0, lastExportAt: null,
    stats: { entries: 3, followUps: 0, images: 0, deleted: 0 },
  };
  assert.equal(dataHealthLevel(report, new Date(report.checkedAt)), 'attention');
  assert.equal(dataHealthLevel({ ...report, stats: { ...report.stats, entries: 0 } }, new Date(report.checkedAt)), 'healthy');
});
