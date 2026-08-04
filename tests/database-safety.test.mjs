import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addMetadataItem,
  applyCoordinatesToLocation,
  cleanupExpiredTrash,
  createFollowUpWithImages,
  createEntry,
  createJournalExport,
  deleteEntry,
  getEntry,
  getFootprintViewPreferences,
  getLocationPageDetail,
  importJournalBackup,
  isNewFootprintLocation,
  listEntryPage,
  listEntryFilterOptions,
  listFavoriteEntryPage,
  listFootprintEntries,
  listMetadataUsage,
  listLocationMapPreferences,
  listJournalMedia,
  listMemoryEntryIndex,
  listMemoryTagIndex,
  removeLocationEverywhere,
  renameTagEverywhere,
  saveLocationDetail,
  saveFootprintViewPreferences,
  toggleMetadataPinned,
  updateLocationPreferences,
  updateLocationCoordinates,
  updateFollowUpWithImages,
  permanentlyDeleteEntry,
  restoreEntry,
  searchEntrySummaries,
  searchEntries,
  setEntryFavorite,
} from '../src/database/journal-repository.ts';
import { DATABASE_VERSION, migrateDatabase } from '../src/database/migrate.ts';
import { getJournalTemplateSettings, saveJournalTemplate } from '../src/database/template-repository.ts';
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
  assert.ok(indexes.some((index) => index.name === 'idx_time_capsules_open_at'));
  assert.ok(indexes.some((index) => index.name === 'idx_time_capsule_replies_capsule_id'));
  assert.ok(indexes.some((index) => index.name === 'idx_time_capsule_images_capsule_id'));
});

test('memory entry and tag indexes stay lightweight and can load independently', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  const entryId = await createEntry(db, { content: '回忆正文', occurredAt: '2026-08-02T12:00:00.000Z' });
  await db.runAsync('INSERT INTO entry_tags (entry_id, label, sort_order) VALUES (?, ?, ?)', entryId, '夏天', 0);
  await db.runAsync(
    'INSERT INTO entry_images (id, entry_id, uri, width, height, sort_order, created_at, media_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    'memory-image', entryId, 'file:///memory.jpg', 800, 600, 0, '2026-08-02T12:00:00.000Z', 'image',
  );
  const index = await listMemoryEntryIndex(db);
  assert.deepEqual(index, [{ id: entryId, occurredAt: '2026-08-02T12:00:00.000Z', imageCount: 1 }]);
  const tags = await listMemoryTagIndex(db);
  assert.deepEqual(tags, [{ entryId, label: '夏天' }]);
});

test('favorite entry pages keep a stable cursor when favorite timestamps match', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  const ids = [];
  for (let index = 0; index < 3; index += 1) {
    const id = await createEntry(db, { content: `收藏 ${index}`, occurredAt: `2026-08-0${index + 1}T12:00:00.000Z` });
    await setEntryFavorite(db, id, true);
    ids.push(id);
  }
  const sharedTime = '2026-08-04T12:00:00.000Z';
  await db.runAsync('UPDATE entries SET favorited_at = ? WHERE id IN (?, ?, ?)', sharedTime, ...ids);
  const first = await listFavoriteEntryPage(db, { limit: 2 });
  const second = await listFavoriteEntryPage(db, { limit: 2, cursor: first.nextCursor });
  assert.equal(first.entries.length, 2);
  assert.equal(second.entries.length, 1);
  assert.deepEqual(new Set([...first.entries, ...second.entries].map((entry) => entry.id)), new Set(ids));
});

test('editing follow-up media returns only files removed after the database update', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  const entryId = await createEntry(db, { content: '正文', occurredAt: '2026-08-02T12:00:00.000Z' });
  const followUpId = await createFollowUpWithImages(db, entryId, '带图后续', [
    { uri: 'file:///keep.jpg', width: 800, height: 600, mediaType: 'image' },
    { uri: 'file:///remove.mp4', width: 1920, height: 1080, mediaType: 'video', thumbnailUri: 'file:///remove-thumb.jpg' },
  ]);
  const before = await getEntry(db, entryId);
  const kept = before.followUps[0].images[0];
  const removed = await updateFollowUpWithImages(db, followUpId, '更新后续', [kept]);
  assert.deepEqual(new Set(removed), new Set(['file:///remove.mp4', 'file:///remove-thumb.jpg']));
  const after = await getEntry(db, entryId);
  assert.equal(after.followUps[0].content, '更新后续');
  assert.deepEqual(after.followUps[0].images.map((image) => image.uri), ['file:///keep.jpg']);
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
  assert.ok(indexes.some((index) => index.name === 'idx_time_capsules_open_at'));
  assert.ok(indexes.some((index) => index.name === 'idx_time_capsule_replies_capsule_id'));
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

test('current backup preserves location details and portable app preferences', async (t) => {
  const sourceDb = await setup();
  const restoredDb = await setup();
  t.after(() => sourceDb.close());
  t.after(() => restoredDb.close());
  await importJournalBackup(sourceDb, backupFixture());
  await saveLocationDetail(sourceDb, '北京', { address: '北京市海淀区', latitude: 39.9, longitude: 116.4 });
  await updateLocationPreferences(sourceDb, '北京', { category: '学校', favorite: true });
  await sourceDb.runAsync(
    "INSERT INTO kv_store (key, value) VALUES ('app-preferences', ?)",
    JSON.stringify({
      nickname: '小拾',
      signature: '今天也认真生活。',
      avatarUri: 'file:///avatar.png',
      readingTheme: 'green',
      fontSize: 'large',
      readingFont: 'sans',
      readingComfort: 'spacious',
      appLockEnabled: true,
      appLockDelaySeconds: 60,
      backupReminderDays: 14,
      backupDirectoryUri: 'content://device-only',
    }),
  );
  await saveJournalTemplate(sourceDb, 'daily-review', { title: '我的复盘', description: '自定义系统模板', content: '今天：' });
  await saveJournalTemplate(sourceDb, null, { title: '周复盘', description: '每周使用', content: '本周：' });

  const backup = await createJournalExport(sourceDb);
  assert.equal(backup.version, 13);
  assert.equal(backup.appPreferences.nickname, '小拾');
  assert.equal(backup.appPreferences.avatarLocalUri, 'file:///avatar.png');
  assert.equal(backup.appPreferences.readingTheme, 'green');
  assert.equal(backup.appPreferences.readingComfort, 'spacious');
  assert.equal('backupDirectoryUri' in backup.appPreferences, false);
  assert.equal(backup.journalTemplates.systemOverrides['daily-review'].title, '我的复盘');
  assert.equal(backup.journalTemplates.custom[0].title, '周复盘');
  await importJournalBackup(restoredDb, backup);
  const detail = await getLocationPageDetail(restoredDb, '北京');
  assert.equal(detail.address, '北京市海淀区');
  assert.equal(detail.category, '学校');
  assert.equal(detail.favorite, true);
  const restoredTemplates = await getJournalTemplateSettings(restoredDb);
  assert.equal(restoredTemplates.systemOverrides['daily-review'].content, '今天：');
  assert.equal(restoredTemplates.custom[0].title, '周复盘');
});

test('timeline combines time-independent tag, location and mood filters', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  const matching = backupFixture();
  const other = backupFixture();
  other.entries[0] = {
    ...other.entries[0],
    id: 'entry-2',
    content: '另一条记录',
    mood: '开心',
    locationName: '上海',
  };
  other.followUps = [];
  other.images = [];
  other.followUpImages = [];
  other.tags = [{ entryId: 'entry-2', label: '其他', sortOrder: 0 }];
  other.versions = [];
  other.suppressedMemoryEntryIds = [];
  await importJournalBackup(db, matching);
  await importJournalBackup(db, other);

  const page = await listEntryPage(db, {
    filters: { tag: '测试', location: '北京', mood: '平静' },
  });
  assert.deepEqual(page.entries.map((entry) => entry.id), ['entry-1']);
});

test('footprint lists active coordinates and counts named locations without coordinates', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  const source = backupFixture();
  const missing = backupFixture();
  missing.entries[0] = {
    ...missing.entries[0],
    id: 'entry-without-coordinates',
    content: '手动地点',
    locationName: '家',
    latitude: null,
    longitude: null,
  };
  missing.followUps = [];
  missing.images = [];
  missing.followUpImages = [];
  missing.tags = [];
  missing.versions = [];
  missing.suppressedMemoryEntryIds = [];
  await importJournalBackup(db, source);
  await importJournalBackup(db, missing);

  const footprint = await listFootprintEntries(db);
  assert.deepEqual(footprint.entries.map((entry) => entry.id), ['entry-1']);
  assert.equal(footprint.missingCoordinates, 1);
  assert.deepEqual(footprint.pendingEntries.map((entry) => entry.id), ['entry-without-coordinates']);
  assert.deepEqual(footprint.pendingGroups, [{ locationName: '家', count: 1 }]);

  await applyCoordinatesToLocation(db, '家', 39.91, 116.39);
  const updated = await getEntry(db, 'entry-without-coordinates');
  assert.equal(updated.latitude, 39.91);
  assert.equal(updated.longitude, 116.39);
  await assert.rejects(() => applyCoordinatesToLocation(db, '家', 200, 116.39), /无效地点坐标/);
});

test('location detail includes saved address, visits and attached media', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  await importJournalBackup(db, backupFixture());
  await saveLocationDetail(db, '北京', {
    address: '北京市海淀区',
    latitude: 39.9,
    longitude: 116.4,
  });
  await updateLocationPreferences(db, '北京', { category: '常去', favorite: true });

  const detail = await getLocationPageDetail(db, '北京');
  assert.equal(detail.name, '北京');
  assert.equal(detail.address, '北京市海淀区');
  assert.equal(detail.category, '常去');
  assert.equal(detail.favorite, true);
  assert.equal(detail.entries.length, 1);
  assert.equal(detail.entries[0].images.length, 1);
  assert.equal(detail.entries[0].tags[0], '测试');
  assert.deepEqual(await listLocationMapPreferences(db), {
    北京: { category: '常去', favorite: true },
  });
  assert.equal(await isNewFootprintLocation(db, '北京', 39.9, 116.4), false);
  assert.equal(await isNewFootprintLocation(db, '附近的新名字', 39.9005, 116.4005), false);
  assert.equal(await isNewFootprintLocation(db, '上海', 31.23, 121.47), true);
  await updateLocationCoordinates(db, '北京', {
    address: '北京市西城区',
    latitude: 39.91,
    longitude: 116.38,
  });
  const corrected = await getLocationPageDetail(db, '北京');
  assert.equal(corrected.address, '北京市西城区');
  assert.equal(corrected.latitude, 39.91);
  assert.equal(corrected.longitude, 116.38);
  assert.equal(corrected.category, '常去');
  assert.equal(corrected.favorite, true);
  assert.equal(await getLocationPageDetail(db, '不存在'), null);
});

test('metadata management merges tags and removes locations without deleting records', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  const source = backupFixture();
  source.tags.push({ entryId: 'entry-1', label: '运动', sortOrder: 1 });
  await importJournalBackup(db, source);

  await renameTagEverywhere(db, '测试', '运动');
  let usage = await listMetadataUsage(db);
  assert.deepEqual(usage.tags.map((item) => ({ ...item })), [{ value: '运动', count: 1, pinned: false }]);

  await removeLocationEverywhere(db, '北京');
  const entry = await getEntry(db, 'entry-1');
  assert.equal(entry.locationName, null);
  assert.equal(entry.latitude, null);
  assert.equal(entry.longitude, null);
  usage = await listMetadataUsage(db);
  assert.equal(usage.locations.length, 0);
});

test('manual metadata and pinned items appear first in entry suggestions', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  await addMetadataItem(db, 'tag', '听歌');
  await addMetadataItem(db, 'tag', '学习');
  await toggleMetadataPinned(db, 'tag', '学习');
  await addMetadataItem(db, 'location', '家');
  await toggleMetadataPinned(db, 'location', '家');

  const options = await listEntryFilterOptions(db);
  assert.deepEqual(options.tags, ['学习', '听歌']);
  assert.deepEqual(options.locations, ['家']);
  const usage = await listMetadataUsage(db);
  assert.deepEqual(usage.tags.map((item) => ({ ...item })), [
    { value: '学习', count: 0, pinned: true },
    { value: '听歌', count: 0, pinned: false },
  ]);
});

test('footprint view preferences persist locally and reject malformed values', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  assert.deepEqual(await getFootprintViewPreferences(db), {
    viewMode: 'map',
    sort: 'recent',
    favoriteOnly: false,
    category: null,
  });
  await saveFootprintViewPreferences(db, {
    viewMode: 'list',
    sort: 'visits',
    favoriteOnly: true,
    category: '旅行',
  });
  assert.deepEqual(await getFootprintViewPreferences(db), {
    viewMode: 'list',
    sort: 'visits',
    favoriteOnly: true,
    category: '旅行',
  });
  await db.runAsync("UPDATE kv_store SET value = 'not-json' WHERE key = 'footprint-view-preferences'");
  assert.equal((await getFootprintViewPreferences(db)).viewMode, 'map');
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

test('media library combines entry and follow-up media and excludes deleted content', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  await importJournalBackup(db, backupFixture());

  const media = await listJournalMedia(db);
  assert.deepEqual(media.map((item) => [item.id, item.source, item.entryId]), [
    ['image-1', 'entry', 'entry-1'],
    ['follow-image-1', 'followUp', 'entry-1'],
  ]);
  assert.equal(media[0].entryContent, '原始正文');
  assert.equal(media[0].sourceContent, '原始正文');
  assert.equal(media[1].sourceContent, '原始后续');

  await deleteEntry(db, 'entry-1');
  assert.deepEqual(await listJournalMedia(db), []);
});

test('search result identifies the matching follow-up for detail navigation', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  await importJournalBackup(db, backupFixture());
  const [result] = await searchEntries(db, '原始后续');
  assert.equal(result.matchingFollowUpId, 'follow-up-1');
  assert.equal(result.matchingFollowUp, '原始后续');
});

test('lightweight search paginates without loading full entry relationships', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  await importJournalBackup(db, backupFixture());
  const page = await searchEntrySummaries(db, '原始后续', { limit: 1 });
  assert.equal(page.results.length, 1);
  assert.deepEqual(page.results[0].entry, { id: 'entry-1', content: '原始正文', occurredAt: '2026-07-26T12:00:00.000Z' });
  assert.equal(page.results[0].matchingFollowUpId, 'follow-up-1');
  assert.deepEqual(page.results[0].sources, ['followUp']);
  assert.equal('images' in page.results[0].entry, false);
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
