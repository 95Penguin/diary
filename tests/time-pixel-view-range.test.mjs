import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateDatabase, DATABASE_VERSION } from '../src/database/migrate.ts';
import { createJournalExport, importJournalBackup } from '../src/database/journal-repository.ts';
import { getTimePixelSnapshot, initializeTimePixels, saveTimePixelPreferences, createTimePixelCategory, saveTimePixelRange } from '../src/database/time-pixel-repository.ts';
import { buildPixelGroups } from '../src/utils/time-pixel-display.ts';
import { parseJournalBackup } from '../src/utils/backup-import.ts';
import { createTestDatabase } from './sqlite-test-adapter.mjs';

test('fixed multi-year ranges include both years and survive backup and restore', async (t) => {
  const db = createTestDatabase();
  const restored = createTestDatabase();
  t.after(() => { db.close(); restored.close(); });
  await migrateDatabase(db); await migrateDatabase(restored);
  await initializeTimePixels(db, '2020-01-01');
  await saveTimePixelPreferences(db, { rangeMode: 'all', originDate: '2023-01-01', endYear: 2024, unit: 'month', unitCustomized: true });
  const snapshot = await getTimePixelSnapshot(db);
  const built = buildPixelGroups(snapshot, snapshot.settings, '2026-10-07');
  assert.deepEqual(built.bounds, { start: '2023-01-01', end: '2024-12-31' });
  assert.equal(built.elapsedDays, 731);
  assert.equal(built.groups.length, 24);
  const backup = parseJournalBackup(JSON.stringify(await createJournalExport(db)));
  await importJournalBackup(restored, backup);
  assert.deepEqual((await getTimePixelSnapshot(restored)).settings, snapshot.settings);
  for (const endYear of [2022, 2024.5, 10000]) {
    assert.throws(() => parseJournalBackup(JSON.stringify({ ...backup, timePixelSettings: { ...backup.timePixelSettings, endYear } })), /invalid-backup/);
  }
});

test('until-present advances across New Year while a fixed end year does not', async (t) => {
  const db = createTestDatabase(); t.after(() => db.close());
  await migrateDatabase(db); await initializeTimePixels(db, '2024-01-01');
  await saveTimePixelPreferences(db, { rangeMode: 'all', endYear: null });
  const snapshot = await getTimePixelSnapshot(db);
  assert.equal(buildPixelGroups(snapshot, snapshot.settings, '2026-12-31').bounds.end, '2026-12-31');
  assert.equal(buildPixelGroups(snapshot, snapshot.settings, '2027-01-01').bounds.end, '2027-01-01');
  const fixed = { ...snapshot.settings, endYear: 2026 };
  assert.equal(buildPixelGroups(snapshot, fixed, '2027-01-01').bounds.end, '2026-12-31');
  const current = buildPixelGroups(snapshot, fixed, '2026-10-07');
  assert.equal(current.futureDays, 85);
});

test('invalid ranges do not persist and switching to a single year preserves the saved multi-year range', async (t) => {
  const db = createTestDatabase(); t.after(() => db.close());
  await migrateDatabase(db); await initializeTimePixels(db, '2015-01-01');
  await saveTimePixelPreferences(db, { rangeMode: 'all', endYear: 2019, unitCustomized: true, unit: 'day' });
  const before = (await getTimePixelSnapshot(db)).settings;
  await assert.rejects(saveTimePixelPreferences(db, { originDate: '2020-01-01' }), /invalid-date-range/);
  await assert.rejects(saveTimePixelPreferences(db, { endYear: 1899 }), /invalid-end-year/);
  await assert.rejects(saveTimePixelPreferences(db, { endYear: 2027 }, new Date('2026-10-07')), /invalid-end-year/);
  assert.deepEqual((await getTimePixelSnapshot(db)).settings, before);
  await saveTimePixelPreferences(db, { rangeMode: 'year', selectedYear: 1900 });
  const single = (await getTimePixelSnapshot(db)).settings;
  assert.equal(single.originDate, '2015-01-01'); assert.equal(single.endYear, 2019);
  assert.equal(single.unitCustomized, true); assert.equal(single.unit, 'day');
  assert.deepEqual(buildPixelGroups({ categories: [], ranges: [] }, single, '2026-10-07').bounds, { start: '1900-01-01', end: '1900-12-31' });
});

test('v20 upgrade retains records, notes, colors and granularity and migrates the old start to its year', async (t) => {
  const db = createTestDatabase(); t.after(() => db.close());
  await migrateDatabase(db);
  await initializeTimePixels(db, '2015-09-01');
  await saveTimePixelPreferences(db, { unit: 'day' });
  const id = await createTimePixelCategory(db, { kind: 'location', name: '家', colorToken: 'fern' });
  await saveTimePixelRange(db, { categoryId: id, startDate: '2015-09-01', endDate: '2015-09-01', note: '开学' });
  const before = await getTimePixelSnapshot(db);
  await db.execAsync('ALTER TABLE time_pixel_settings DROP COLUMN end_year; ALTER TABLE time_pixel_settings DROP COLUMN unit_customized; PRAGMA user_version = 20;');
  await migrateDatabase(db);
  const after = await getTimePixelSnapshot(db);
  assert.equal((await db.getFirstAsync('PRAGMA user_version')).user_version, DATABASE_VERSION);
  assert.equal(after.settings.originDate, '2015-01-01'); assert.equal(after.settings.endYear, null);
  assert.equal(after.settings.unit, 'day'); assert.equal(after.settings.unitCustomized, true);
  assert.deepEqual(after.ranges, before.ranges); assert.deepEqual(after.categories, before.categories);
  await migrateDatabase(db);
  assert.deepEqual(await getTimePixelSnapshot(db), after);
});

test('legacy backups keep the old view and manual granularity; one-day records outside it do not move the view', async (t) => {
  const db = createTestDatabase(); t.after(() => db.close());
  await migrateDatabase(db);
  const backup = await createJournalExport(db);
  backup.timePixelSettings = { originDate: '2020-09-01', rangeMode: 'all', selectedYear: null, unit: 'year', colorMode: 'location', updatedAt: '2026-10-07T00:00:00Z' };
  await importJournalBackup(db, parseJournalBackup(JSON.stringify(backup)));
  const settings = (await getTimePixelSnapshot(db)).settings;
  assert.equal(settings.originDate, '2020-01-01'); assert.equal(settings.endYear, null); assert.equal(settings.unitCustomized, true);
  const id = await createTimePixelCategory(db, { kind: 'location', name: '学校', colorToken: 'mist' });
  await saveTimePixelRange(db, { categoryId: id, startDate: '2015-09-01', endDate: '2015-09-01' });
  const after = await getTimePixelSnapshot(db);
  assert.deepEqual(after.settings, settings);
  assert.equal(buildPixelGroups(after, { ...settings, rangeMode: 'year', selectedYear: 2015 }, '2026-10-07').recordedDays, 1);
});
