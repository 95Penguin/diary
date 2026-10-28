import assert from 'node:assert/strict';
import test from 'node:test';

import { createJournalExport, importJournalBackup } from '../src/database/journal-repository.ts';
import { migrateDatabase } from '../src/database/migrate.ts';
import { deleteSleepRecord, getLatestSleepRecords, saveSleepRecord, sleepNightDate } from '../src/database/sleep-repository.ts';
import { createTestDatabase } from './sqlite-test-adapter.mjs';

test('sleep records group early morning times into the previous night', () => {
  assert.equal(sleepNightDate(new Date(2026, 9, 27, 0, 30)), '2026-10-26');
  assert.equal(sleepNightDate(new Date(2026, 9, 27, 11, 59)), '2026-10-26');
  assert.equal(sleepNightDate(new Date(2026, 9, 27, 12, 0)), '2026-10-27');
});

test('same-night records update in place and older backups do not revive deletions', async (t) => {
  const db = createTestDatabase();
  const restored = createTestDatabase();
  t.after(() => { db.close(); restored.close(); });
  await migrateDatabase(db);
  await migrateDatabase(restored);

  const beforeMidnight = new Date(2026, 9, 27, 23, 55).toISOString();
  const afterMidnight = new Date(2026, 9, 28, 0, 20).toISOString();
  const first = await saveSleepRecord(db, beforeMidnight);
  const repeated = await saveSleepRecord(db, afterMidnight);
  assert.equal(repeated.id, first.id);
  assert.equal(repeated.nightDate, '2026-10-27');
  assert.equal((await getLatestSleepRecords(db)).length, 1);

  const staleBackup = await createJournalExport(db);
  await deleteSleepRecord(db, first.id);
  await importJournalBackup(db, staleBackup);
  assert.equal((await getLatestSleepRecords(db)).length, 0);

  const current = await saveSleepRecord(db, new Date(2026, 9, 28, 1, 10).toISOString());
  await importJournalBackup(db, staleBackup);
  const records = await getLatestSleepRecords(db);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, current.id);

  const currentBackup = await createJournalExport(db);
  assert.deepEqual(currentBackup.sleepRecordDeletions.map(({ id }) => id), [first.id]);
  await importJournalBackup(restored, staleBackup);
  await importJournalBackup(restored, currentBackup);
  const restoredRecords = await getLatestSleepRecords(restored);
  assert.equal(restoredRecords.length, 1);
  assert.equal(restoredRecords[0].id, current.id);
});

test('document correction replaces untouched imports and keeps manual changes on repeat import', async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  await migrateDatabase(db);
  const oldTime = '2026-10-01T16:11:00.000Z';
  const editedTime = '2026-10-10T17:29:00.000Z';
  await db.runAsync('INSERT INTO sleep_records (id, night_date, occurred_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', 'sleep-docx-20261001', '2026-10-01', oldTime, oldTime, oldTime);
  await db.runAsync('INSERT INTO sleep_records (id, night_date, occurred_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', 'sleep-docx-20261010', '2026-10-10', editedTime, editedTime, '2026-10-28T00:00:00.000Z');
  const manual = await saveSleepRecord(db, '2026-10-12T17:00:00.000Z');
  const base = await createJournalExport(db);
  const corrected = (date, time) => ({ id: `sleep-docx-corrected-${date.replaceAll('-', '')}`, nightDate: date, occurredAt: time, createdAt: time, updatedAt: time });
  const correction = { ...base, sleepRecords: [corrected('2026-10-01', '2026-10-02T16:11:00.000Z'), corrected('2026-10-11', '2026-10-12T17:29:00.000Z'), corrected('2026-10-12', '2026-10-13T17:00:00.000Z')], sleepRecordDeletions: [], sleepHistoryCorrection: { source: 'sleep-docx-20261027', replacements: [{ legacyId: 'sleep-docx-20261001', correctedId: 'sleep-docx-corrected-20261001' }, { legacyId: 'sleep-docx-20261010', correctedId: 'sleep-docx-corrected-20261011' }] } };
  await importJournalBackup(db, correction);
  await importJournalBackup(db, correction);
  const rows = await getLatestSleepRecords(db);
  assert.equal(rows.length, 3);
  assert.equal(rows.find((item) => item.nightDate === '2026-10-01')?.id, 'sleep-docx-corrected-20261001');
  assert.equal(rows.find((item) => item.nightDate === '2026-10-10')?.id, 'sleep-docx-20261010');
  assert.equal(rows.find((item) => item.nightDate === '2026-10-12')?.id, manual.id);
  assert.equal(rows.some((item) => item.nightDate === '2026-10-11'), false);
  await importJournalBackup(db, base);
  assert.equal((await getLatestSleepRecords(db)).length, 3);
});
