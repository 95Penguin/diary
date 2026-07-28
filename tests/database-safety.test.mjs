import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cleanupExpiredTrash,
  createFollowUpWithImages,
  createJournalExport,
  deleteEntry,
  getEntry,
  importJournalBackup,
  permanentlyDeleteEntry,
  restoreEntry,
} from '../src/database/journal-repository.ts';
import { DATABASE_VERSION, migrateDatabase } from '../src/database/migrate.ts';
import { createTestDatabase } from './sqlite-test-adapter.mjs';

function backupFixture() {
  return {
    format: 'shishi-journal',
    version: 9,
    exportedAt: '2026-07-27T12:00:00.000Z',
    timezone: 'Asia/Shanghai',
    entries: [{
      id: 'entry-1',
      content: '原始正文',
      occurredAt: '2026-07-26T12:00:00.000Z',
      createdAt: '2026-07-26T12:00:00.000Z',
      updatedAt: '2026-07-26T12:00:00.000Z',
      deletedAt: null,
      mood: '平静',
      weather: '晴',
      favoritedAt: null,
      locationName: '北京',
      latitude: 39.9,
      longitude: 116.4,
    }],
    followUps: [{
      id: 'follow-up-1',
      entryId: 'entry-1',
      content: '原始后续',
      createdAt: '2026-07-26T13:00:00.000Z',
      updatedAt: '2026-07-26T13:00:00.000Z',
      deletedAt: null,
    }],
    images: [{
      id: 'image-1',
      entryId: 'entry-1',
      localUri: 'file:///journal-images/video.mp4',
      width: 1920,
      height: 1080,
      sortOrder: 0,
      createdAt: '2026-07-26T12:00:00.000Z',
      mediaType: 'video',
      pairedVideoLocalUri: null,
      duration: 8,
      thumbnailLocalUri: 'file:///journal-images/video-thumbnail.jpg',
    }],
    followUpImages: [{
      id: 'follow-image-1',
      followUpId: 'follow-up-1',
      localUri: 'file:///journal-images/follow-up.jpg',
      width: 800,
      height: 600,
      sortOrder: 0,
      createdAt: '2026-07-26T13:00:00.000Z',
      mediaType: 'image',
      pairedVideoLocalUri: null,
      duration: null,
      thumbnailLocalUri: null,
    }],
    tags: [{ entryId: 'entry-1', label: '测试', sortOrder: 0 }],
    versions: [{
      id: 'version-1',
      entryId: 'entry-1',
      content: '历史正文',
      occurredAt: '2026-07-25T12:00:00.000Z',
      mood: null,
      weather: null,
      locationName: null,
      latitude: null,
      longitude: null,
      tags: ['旧标签'],
      createdAt: '2026-07-26T11:00:00.000Z',
    }],
    suppressedMemoryEntryIds: ['entry-1'],
  };
}

async function setup() {
  const db = createTestDatabase();
  await migrateDatabase(db);
  return db;
}

test('fresh baseline reaches the current schema and is idempotent', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  await migrateDatabase(db);
  const version = await db.getFirstAsync('PRAGMA user_version');
  assert.equal(version.user_version, DATABASE_VERSION);
  const entryColumns = await db.getAllAsync('PRAGMA table_info(entries)');
  assert.ok(entryColumns.some((column) => column.name === 'weather'));
  assert.ok(entryColumns.some((column) => column.name === 'location_name'));
  const imageColumns = await db.getAllAsync('PRAGMA table_info(entry_images)');
  assert.ok(imageColumns.some((column) => column.name === 'thumbnail_uri'));
  assert.ok(imageColumns.some((column) => column.name === 'media_type'));
  const followUpImageColumns = await db.getAllAsync('PRAGMA table_info(follow_up_images)');
  assert.ok(followUpImageColumns.some((column) => column.name === 'thumbnail_uri'));
  const indexes = await db.getAllAsync(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'",
  );
  assert.ok(indexes.some((index) => index.name === 'idx_entries_timeline_page'));
  assert.ok(indexes.some((index) => index.name === 'idx_entries_mood'));
  assert.ok(indexes.some((index) => index.name === 'idx_follow_ups_created_at'));
  assert.ok(indexes.some((index) => index.name === 'idx_entry_tags_entry_id'));
});

test('development-only schemas v1-v12 are rejected instead of guessed forward', async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  for (let version = 1; version < 13; version += 1) {
    await db.execAsync(`PRAGMA user_version = ${version}`);
    await assert.rejects(() => migrateDatabase(db), /导出 ZIP 备份/);
    assert.equal((await db.getFirstAsync('PRAGMA user_version')).user_version, version);
  }
});

test('production baseline v13 migrates forward without rebuilding user tables', async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  await db.execAsync(`
    CREATE TABLE entries (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE follow_ups (
      id TEXT PRIMARY KEY NOT NULL,
      entry_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE entry_tags (
      entry_id TEXT NOT NULL,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (entry_id, label)
    );
    INSERT INTO entries (id) VALUES ('kept');
    PRAGMA user_version = 13;
  `);
  await migrateDatabase(db);
  assert.equal((await db.getFirstAsync('PRAGMA user_version')).user_version, DATABASE_VERSION);
  assert.equal((await db.getFirstAsync('SELECT id FROM entries')).id, 'kept');
  const indexes = await db.getAllAsync(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'",
  );
  assert.ok(indexes.some((index) => index.name === 'idx_follow_ups_created_at'));
  assert.ok(indexes.some((index) => index.name === 'idx_entry_tags_entry_id'));
});

test('older app refuses a database created by a newer schema', async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  await db.execAsync('PRAGMA user_version = 99');
  await assert.rejects(() => migrateDatabase(db), /更新版本/);
  assert.equal((await db.getFirstAsync('PRAGMA user_version')).user_version, 99);
});

test('migration is atomic when a schema statement fails', async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  await db.execAsync(`
    CREATE TABLE entries (id TEXT PRIMARY KEY NOT NULL);
    PRAGMA user_version = 0;
  `);
  await assert.rejects(() => migrateDatabase(db));
  assert.equal((await db.getFirstAsync('PRAGMA user_version')).user_version, 0);
  const tables = await db.getAllAsync("SELECT name FROM sqlite_master WHERE type = 'table'");
  assert.equal(tables.some((row) => row.name === 'follow_ups'), false);
});

test('backup import/export preserves records, media, tags, versions and suppression', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  const source = backupFixture();
  const result = await importJournalBackup(db, source);
  assert.deepEqual(result, {
    createdEntries: 1,
    updatedEntries: 0,
    createdFollowUps: 1,
    updatedFollowUps: 0,
    tags: 1,
  });

  const exported = await createJournalExport(db);
  assert.equal(exported.entries[0].content, source.entries[0].content);
  assert.equal(exported.followUps[0].content, source.followUps[0].content);
  assert.deepEqual(exported.images[0], source.images[0]);
  assert.deepEqual(exported.followUpImages[0], source.followUpImages[0]);
  assert.deepEqual(exported.tags, source.tags);
  assert.deepEqual(exported.versions, source.versions);
  assert.deepEqual(exported.suppressedMemoryEntryIds, source.suppressedMemoryEntryIds);
});

test('restore merge keeps newer local content and accepts a newer backup', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  const source = backupFixture();
  await importJournalBackup(db, source);

  const older = structuredClone(source);
  older.entries[0].content = '不应覆盖';
  older.entries[0].updatedAt = '2026-07-25T00:00:00.000Z';
  assert.equal((await importJournalBackup(db, older)).updatedEntries, 0);
  assert.equal((await getEntry(db, 'entry-1')).content, '原始正文');

  const newer = structuredClone(source);
  newer.entries[0].content = '新的正文';
  newer.entries[0].updatedAt = '2026-07-27T13:00:00.000Z';
  assert.equal((await importJournalBackup(db, newer)).updatedEntries, 1);
  assert.equal((await getEntry(db, 'entry-1')).content, '新的正文');
});

test('restoring the same backup twice is idempotent and creates no duplicate rows', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  const source = backupFixture();
  await importJournalBackup(db, source);
  const repeated = await importJournalBackup(db, source);
  assert.deepEqual(repeated, {
    createdEntries: 0,
    updatedEntries: 0,
    createdFollowUps: 0,
    updatedFollowUps: 0,
    tags: 0,
  });
  for (const table of [
    'entries',
    'follow_ups',
    'entry_images',
    'follow_up_images',
    'entry_tags',
    'entry_versions',
    'memory_suppressed_entries',
  ]) {
    assert.equal(
      (await db.getFirstAsync(`SELECT COUNT(*) AS count FROM ${table}`)).count,
      1,
      `${table} should contain one row`,
    );
  }
});

test('failed import rolls back every record in the transaction', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  const broken = backupFixture();
  broken.entries.push({
    ...broken.entries[0],
    id: 'entry-invalid',
    content: null,
  });
  await assert.rejects(() => importJournalBackup(db, broken));
  assert.equal(await getEntry(db, 'entry-1'), null);
});

test('trash restore returns an entry and only its jointly deleted follow-ups', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  await importJournalBackup(db, backupFixture());
  await createFollowUpWithImages(db, 'entry-1', '稍后添加', []);

  await deleteEntry(db, 'entry-1');
  assert.equal(await getEntry(db, 'entry-1'), null);
  await restoreEntry(db, 'entry-1');
  const restored = await getEntry(db, 'entry-1');
  assert.equal(restored.content, '原始正文');
  assert.deepEqual(restored.followUps.map((item) => item.content), ['原始后续', '稍后添加']);
});

test('permanent deletion cascades rows and returns every associated media URI', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  await importJournalBackup(db, backupFixture());
  await deleteEntry(db, 'entry-1');
  const uris = await permanentlyDeleteEntry(db, 'entry-1');
  assert.deepEqual(new Set(uris), new Set([
    'file:///journal-images/video.mp4',
    'file:///journal-images/video-thumbnail.jpg',
    'file:///journal-images/follow-up.jpg',
  ]));
  assert.equal(await db.getFirstAsync('SELECT id FROM entries WHERE id = ?', 'entry-1'), undefined);
  assert.equal((await db.getFirstAsync('SELECT COUNT(*) AS count FROM follow_ups')).count, 0);
  assert.equal((await db.getFirstAsync('SELECT COUNT(*) AS count FROM entry_images')).count, 0);
});

test('permanent deletion refuses active entries and keeps their media references', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  await importJournalBackup(db, backupFixture());
  assert.deepEqual(await permanentlyDeleteEntry(db, 'entry-1'), []);
  assert.equal((await db.getFirstAsync('SELECT id FROM entries WHERE id = ?', 'entry-1')).id, 'entry-1');
  assert.equal((await db.getFirstAsync('SELECT COUNT(*) AS count FROM entry_images')).count, 1);
});

test('expired trash cleanup keeps recent trash and removes only expired media', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  const source = backupFixture();
  source.entries.push({
    ...source.entries[0],
    id: 'entry-recent',
    content: '最近删除',
    updatedAt: '2026-07-27T00:00:00.000Z',
  });
  source.images.push({
    ...source.images[0],
    id: 'image-recent',
    entryId: 'entry-recent',
    localUri: 'file:///journal-images/recent.mp4',
    thumbnailLocalUri: null,
  });
  await importJournalBackup(db, source);
  const expired = '2020-01-01T00:00:00.000Z';
  const recent = new Date().toISOString();
  await db.runAsync('UPDATE entries SET deleted_at = ? WHERE id = ?', expired, 'entry-1');
  await db.runAsync('UPDATE entries SET deleted_at = ? WHERE id = ?', recent, 'entry-recent');

  const removedUris = await cleanupExpiredTrash(db, 30);
  assert.deepEqual(new Set(removedUris), new Set([
    'file:///journal-images/video.mp4',
    'file:///journal-images/video-thumbnail.jpg',
    'file:///journal-images/follow-up.jpg',
  ]));
  assert.equal(await db.getFirstAsync('SELECT id FROM entries WHERE id = ?', 'entry-1'), undefined);
  assert.equal((await db.getFirstAsync('SELECT id FROM entries WHERE id = ?', 'entry-recent')).id, 'entry-recent');
});

test('trash cleanup rejects invalid retention values without changing data', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  await importJournalBackup(db, backupFixture());
  await deleteEntry(db, 'entry-1');
  await assert.rejects(() => cleanupExpiredTrash(db, -1), /retentionDays/);
  await assert.rejects(() => cleanupExpiredTrash(db, Number.NaN), /retentionDays/);
  assert.equal((await db.getFirstAsync('SELECT id FROM entries WHERE id = ?', 'entry-1')).id, 'entry-1');
});
