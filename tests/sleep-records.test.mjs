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
