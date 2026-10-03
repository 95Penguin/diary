import assert from 'node:assert/strict';
import test from 'node:test';

import { createJournalExport, importJournalBackup } from '../src/database/journal-repository.ts';
import { migrateDatabase } from '../src/database/migrate.ts';
import {
  createTimePixelCategory,
  deleteTimePixelRange,
  getTimePixelSnapshot,
  initializeTimePixels,
  saveTimePixelPreferences,
  saveTimePixelRange,
  updateTimePixelCategory,
} from '../src/database/time-pixel-repository.ts';
import { parseJournalBackup } from '../src/utils/backup-import.ts';
import { mergeTimePixelRanges } from '../src/utils/time-pixels.ts';
import { createTestDatabase } from './sqlite-test-adapter.mjs';

async function setup() {
  const db = createTestDatabase();
  await migrateDatabase(db);
  return db;
}

test('time pixels keep location and life-stage ranges independent while replacing overlaps', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  await initializeTimePixels(db, '2009-09-01', createdAt);
  const homeId = await createTimePixelCategory(db, { kind: 'location', name: '老家', colorToken: 'fern' }, createdAt);
  const dormId = await createTimePixelCategory(db, { kind: 'location', name: '学校宿舍', colorToken: 'mist' }, createdAt);
  const schoolId = await createTimePixelCategory(db, { kind: 'stage', name: '上小学', colorToken: 'amber' }, createdAt);

  await saveTimePixelRange(db, { categoryId: homeId, startDate: '2009-09-01', endDate: '2015-08-31', note: '大多数日子都住在家里' }, createdAt);
  await saveTimePixelRange(db, { categoryId: schoolId, startDate: '2009-09-01', endDate: '2015-08-31', note: '小学六年' }, createdAt);
  const dormRangeId = await saveTimePixelRange(db, { categoryId: dormId, startDate: '2012-09-01', endDate: '2012-09-30', note: '短住一个月' }, new Date('2026-01-02T00:00:00.000Z'));

  const snapshot = await getTimePixelSnapshot(db);
  assert.deepEqual(
    snapshot.ranges.filter((range) => range.kind === 'location').map(({ categoryId, startDate, endDate, note }) => ({ categoryId, startDate, endDate, note })),
    [
      { categoryId: homeId, startDate: '2009-09-01', endDate: '2012-08-31', note: '大多数日子都住在家里' },
      { categoryId: dormId, startDate: '2012-09-01', endDate: '2012-09-30', note: '短住一个月' },
      { categoryId: homeId, startDate: '2012-10-01', endDate: '2015-08-31', note: '大多数日子都住在家里' },
    ],
  );
  assert.deepEqual(
    snapshot.ranges.filter((range) => range.kind === 'stage').map(({ categoryId, startDate, endDate, note }) => ({ categoryId, startDate, endDate, note })),
    [{ categoryId: schoolId, startDate: '2009-09-01', endDate: '2015-08-31', note: '小学六年' }],
  );

  await deleteTimePixelRange(db, dormRangeId);
  assert.equal((await getTimePixelSnapshot(db)).ranges.some((range) => range.id === dormRangeId), false);
});

test('time pixel names, colors and last-used view preferences persist', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  const first = new Date('2026-01-01T00:00:00.000Z');
  const second = new Date('2026-01-02T00:00:00.000Z');
  await initializeTimePixels(db, '2018-09-01', first);
  const categoryId = await createTimePixelCategory(db, { kind: 'stage', name: '大学', colorToken: 'lavender' }, first);
  await updateTimePixelCategory(db, categoryId, { name: '上大学', colorToken: 'rose' }, second);
  await saveTimePixelPreferences(db, { rangeMode: 'year', selectedYear: 2024, unit: 'day', colorMode: 'stage' }, second);

  const snapshot = await getTimePixelSnapshot(db);
  assert.equal(snapshot.categories[0].name, '上大学');
  assert.equal(snapshot.categories[0].colorToken, 'rose');
  assert.deepEqual(snapshot.settings, {
    originDate: '2018-09-01',
    rangeMode: 'year',
    selectedYear: 2024,
    unit: 'day',
    colorMode: 'stage',
    updatedAt: second.toISOString(),
  });
});

test('backup validation and restore preserve time pixels', async (t) => {
  const source = await setup();
  const target = await setup();
  t.after(() => { source.close(); target.close(); });
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  await initializeTimePixels(source, '2020-01-01', createdAt);
  const categoryId = await createTimePixelCategory(source, { kind: 'location', name: '杭州', colorToken: 'teal' }, createdAt);
  await saveTimePixelRange(source, { categoryId, startDate: '2020-01-01', endDate: '2020-12-31', note: '工作第一年' }, createdAt);
  const localCategoryId = await createTimePixelCategory(target, { kind: 'location', name: '杭州', colorToken: 'slate' }, new Date('2025-01-01T00:00:00.000Z'));

  const backup = await createJournalExport(source);
  assert.equal(backup.version, 15);
  const parsed = parseJournalBackup(JSON.stringify(backup));
  await importJournalBackup(target, parsed);
  const restored = await getTimePixelSnapshot(target);
  assert.equal(restored.settings?.originDate, '2020-01-01');
  assert.equal(restored.categories.length, 1);
  assert.equal(restored.categories[0].id, localCategoryId);
  assert.equal(restored.categories[0].name, '杭州');
  assert.equal(restored.categories[0].colorToken, 'teal');
  assert.equal(restored.ranges[0].categoryId, localCategoryId);
  assert.equal(restored.ranges[0].note, '工作第一年');

  const malformed = structuredClone(backup);
  malformed.timePixelRanges[0].categoryId = 'missing-category';
  assert.throws(() => parseJournalBackup(JSON.stringify(malformed)), /invalid-backup/);
});

test('observation start uses the local date near midnight in both timezone directions', async (t) => {
  const previous = process.env.TZ;
  t.after(() => { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; });
  for (const zone of ['Asia/Shanghai', 'America/Los_Angeles']) {
    process.env.TZ = zone;
    const db = await setup();
    try {
      const now = new Date(2026, 9, 2, 0, 30);
      await initializeTimePixels(db, '2026-10-02', now);
      await assert.rejects(initializeTimePixels(db, '2026-10-03', new Date(2026, 9, 2, 23, 30)), /invalid-origin-date/);
      assert.equal((await getTimePixelSnapshot(db)).settings.originDate, '2026-10-02');
    } finally { db.close(); }
  }
});

test('moving the observation start resets an excluded year without deleting records or other preferences', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  await initializeTimePixels(db, '2018-01-01');
  const id = await createTimePixelCategory(db, { kind: 'stage', name: '上学', colorToken: 'fern' });
  await saveTimePixelRange(db, { categoryId: id, startDate: '2018-01-01', endDate: '2024-01-01', note: '保留旧记录' });
  await saveTimePixelPreferences(db, { rangeMode: 'year', selectedYear: 2020, unit: 'day', colorMode: 'stage' });
  await initializeTimePixels(db, '2022-01-01');
  const snapshot = await getTimePixelSnapshot(db);
  assert.equal(snapshot.settings.rangeMode, 'all');
  assert.equal(snapshot.settings.selectedYear, null);
  assert.equal(snapshot.settings.unit, 'day');
  assert.equal(snapshot.settings.colorMode, 'stage');
  assert.equal(snapshot.ranges[0].startDate, '2018-01-01');
  await saveTimePixelPreferences(db, { rangeMode: 'year', selectedYear: 2024 });
  await initializeTimePixels(db, '2023-01-01');
  assert.equal((await getTimePixelSnapshot(db)).settings.selectedYear, 2024);
  await assert.rejects(saveTimePixelPreferences(db, { rangeMode: 'year', selectedYear: 2020 }), /invalid-time-pixel-preferences/);
});

test('independent preference updates preserve each other under rapid changes', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  await initializeTimePixels(db, '2018-01-01');
  await Promise.all([
    saveTimePixelPreferences(db, { unit: 'day' }),
    saveTimePixelPreferences(db, { colorMode: 'stage' }),
    saveTimePixelPreferences(db, { rangeMode: 'year', selectedYear: 2024 }),
  ]);
  const { settings } = await getTimePixelSnapshot(db);
  assert.equal(settings.unit, 'day');
  assert.equal(settings.colorMode, 'stage');
  assert.equal(settings.selectedYear, 2024);
  await assert.rejects(saveTimePixelPreferences(db, { rangeMode: 'year', selectedYear: null }), /invalid-selected-year/);
});

test('restore resolves overlapping days by edit time and remains idempotent', async (t) => {
  const source = await setup();
  const target = await setup();
  t.after(() => { source.close(); target.close(); });
  const old = new Date('2025-01-01T00:00:00.000Z');
  const newer = new Date('2025-02-01T00:00:00.000Z');
  const home = await createTimePixelCategory(source, { kind: 'location', name: '家', colorToken: 'fern' }, old);
  const school = await createTimePixelCategory(target, { kind: 'location', name: '学校', colorToken: 'mist' }, old);
  const stage = await createTimePixelCategory(target, { kind: 'stage', name: '上学', colorToken: 'amber' }, old);
  await saveTimePixelRange(source, { categoryId: home, startDate: '2020-01-01', endDate: '2020-01-31', note: '旧备份' }, old);
  await saveTimePixelRange(target, { categoryId: school, startDate: '2020-01-10', endDate: '2020-01-20', note: '较新的本机记录' }, newer);
  await saveTimePixelRange(target, { categoryId: stage, startDate: '2020-01-01', endDate: '2020-01-31' }, old);
  const backup = parseJournalBackup(JSON.stringify(await createJournalExport(source)));
  await importJournalBackup(target, backup);
  const restored = await getTimePixelSnapshot(target);
  assert.deepEqual(restored.ranges.filter((r) => r.kind === 'location').map((r) => [r.startDate, r.endDate, r.note]), [
    ['2020-01-01', '2020-01-09', '旧备份'],
    ['2020-01-10', '2020-01-20', '较新的本机记录'],
    ['2020-01-21', '2020-01-31', '旧备份'],
  ]);
  assert.equal(restored.ranges.filter((r) => r.kind === 'stage').length, 1);
  await importJournalBackup(target, backup);
  assert.deepEqual(await getTimePixelSnapshot(target), restored);
  const newBackup = structuredClone(backup);
  newBackup.timePixelRanges[0].updatedAt = '2025-03-01T00:00:00.000Z';
  await importJournalBackup(target, newBackup);
  assert.deepEqual((await getTimePixelSnapshot(target)).ranges.filter((r) => r.kind === 'location').map((r) => [r.startDate, r.endDate]), [['2020-01-01', '2020-01-31']]);
});

test('range merge keeps local ties, notes, and leap-day boundaries', () => {
  const base = { kind: 'location', categoryId: 'home', note: '保留', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' };
  const local = [{ ...base, id: 'local', startDate: '2024-02-29', endDate: '2024-02-29' }];
  const incoming = [{ ...base, categoryId: 'school', id: 'backup', startDate: '2024-02-28', endDate: '2024-03-01' }];
  const merged = mergeTimePixelRanges(local, incoming);
  assert.deepEqual(merged.map((r) => [r.startDate, r.endDate, r.categoryId]), [
    ['2024-02-28', '2024-02-28', 'school'], ['2024-02-29', '2024-02-29', 'home'], ['2024-03-01', '2024-03-01', 'school'],
  ]);
  assert.ok(merged.every((r) => r.note === '保留'));
  assert.deepEqual(mergeTimePixelRanges(merged, incoming), merged);
});

test('backup validation rejects inconsistent year settings', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  await initializeTimePixels(db, '2020-01-01');
  const backup = await createJournalExport(db);
  for (const selectedYear of [null, 2019, 2020.5]) {
    backup.timePixelSettings = { ...backup.timePixelSettings, rangeMode: 'year', selectedYear };
    assert.throws(() => parseJournalBackup(JSON.stringify(backup)), /invalid-backup/);
  }
  backup.timePixelSettings.selectedYear = 2020;
  assert.doesNotThrow(() => parseJournalBackup(JSON.stringify(backup)));
  backup.timePixelSettings.rangeMode = 'all';
  assert.throws(() => parseJournalBackup(JSON.stringify(backup)), /invalid-backup/);
});

test('a restored conflicting category rename does not invalidate subsequent backups', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  const old = new Date('2025-01-01T00:00:00.000Z');
  const id = await createTimePixelCategory(db, { kind: 'location', name: '家', colorToken: 'fern' }, old);
  const backup = await createJournalExport(db);
  backup.timePixelCategories[0].name = '学校';
  backup.timePixelCategories[0].updatedAt = '2025-02-01T00:00:00.000Z';
  await createTimePixelCategory(db, { kind: 'location', name: '学校', colorToken: 'mist' }, old);
  await importJournalBackup(db, backup);
  assert.equal((await getTimePixelSnapshot(db)).categories.find((c) => c.id === id).name, '家');
  assert.doesNotThrow(() => parseJournalBackup(JSON.stringify(backup)));
  const exported = await createJournalExport(db);
  assert.doesNotThrow(() => parseJournalBackup(JSON.stringify(exported)));
});

test('a failed range restore rolls back categories, splits and removed records', async (t) => {
  const db = await setup();
  const source = await setup();
  t.after(() => { db.close(); source.close(); });
  const localId = await createTimePixelCategory(db, { kind: 'location', name: '家', colorToken: 'fern' });
  await saveTimePixelRange(db, { categoryId: localId, startDate: '2020-01-01', endDate: '2020-01-31' }, new Date('2025-01-01T00:00:00.000Z'));
  const otherId = await createTimePixelCategory(source, { kind: 'location', name: '旅行', colorToken: 'mist' });
  await saveTimePixelRange(source, { categoryId: otherId, startDate: '2020-01-01', endDate: '2020-01-31' }, new Date('2025-02-01T00:00:00.000Z'));
  const backup = await createJournalExport(source);
  const before = await getTimePixelSnapshot(db);
  const run = db.runAsync;
  db.runAsync = async (sql, ...args) => {
    if (sql.includes('INSERT INTO time_pixel_ranges')) throw new Error('simulated-write-failure');
    return run(sql, ...args);
  };
  await assert.rejects(importJournalBackup(db, backup), /simulated-write-failure/);
  db.runAsync = run;
  assert.deepEqual(await getTimePixelSnapshot(db), before);
});

test('range merge covers each day once and is stable across repeated restores', () => {
  let seed = 47;
  const random = (max) => { seed = (seed * 16807) % 2147483647; return seed % max; };
  const key = (day) => `2024-01-${String(day).padStart(2, '0')}`;
  for (let scenario = 0; scenario < 80; scenario++) {
    const make = (prefix) => Array.from({ length: 8 }, (_, i) => {
      const start = random(25) + 1;
      const timestamp = `2025-01-0${random(4) + 1}T00:00:00.000Z`;
      return { id: `${prefix}-${i}`, categoryId: `${prefix}-category-${i}`, kind: i % 2 ? 'stage' : 'location',
        startDate: key(start), endDate: key(start + random(32 - start)), note: `备注${i}`, createdAt: timestamp, updatedAt: timestamp };
    });
    const local = make('local');
    const incoming = make('incoming');
    const merged = mergeTimePixelRanges(local, incoming);
    assert.equal(new Set(merged.map((r) => r.id)).size, merged.length);
    for (let day = 1; day <= 31; day++) for (const kind of ['location', 'stage']) {
      const expected = [...local, ...incoming].filter((r) => r.kind === kind && r.startDate <= key(day) && r.endDate >= key(day))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || Number(b.id.startsWith('local')) - Number(a.id.startsWith('local')) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))[0];
      const actual = merged.filter((r) => r.kind === kind && r.startDate <= key(day) && r.endDate >= key(day));
      assert.equal(actual.length, expected ? 1 : 0);
      assert.equal(actual[0]?.categoryId, expected?.categoryId);
    }
    assert.deepEqual(mergeTimePixelRanges(merged, incoming), merged);
  }
});
