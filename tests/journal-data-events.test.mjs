import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCoordinatesToLocations, createEntry, getEntry } from '../src/database/journal-repository.ts';
import { migrateDatabase } from '../src/database/migrate.ts';
import { publishJournalDataChange, subscribeToJournalDataChanges } from '../src/utils/journal-data-events.ts';
import { createTestDatabase } from './sqlite-test-adapter.mjs';

test('journal data changes publish affected domains and stop after unsubscribe', () => {
  const received = [];
  const unsubscribe = subscribeToJournalDataChanges((domains) => received.push([...domains].sort()));

  publishJournalDataChange('metadata', 'entries', 'metadata');
  unsubscribe();
  publishJournalDataChange('media');

  assert.deepEqual(received, [['entries', 'metadata']]);
});

test('a failing journal data listener does not block committed change notifications', () => {
  const received = [];
  const unsubscribeBroken = subscribeToJournalDataChanges(() => { throw new Error('listener-failed'); });
  const unsubscribeHealthy = subscribeToJournalDataChanges((domains) => received.push([...domains]));

  assert.doesNotThrow(() => publishJournalDataChange('media'));
  unsubscribeBroken();
  unsubscribeHealthy();

  assert.deepEqual(received, [['media']]);
});

test('repository writes publish only after the database write succeeds', async (t) => {
  const db = createTestDatabase();
  await migrateDatabase(db);
  t.after(() => db.close());
  const received = [];
  const unsubscribe = subscribeToJournalDataChanges((domains) => received.push([...domains].sort()));
  t.after(unsubscribe);

  await createEntry(db, { content: '同步测试', occurredAt: '2026-09-25T08:00:00.000Z' });
  await assert.rejects(() => createEntry({
    runAsync: async () => { throw new Error('write-failed'); },
  }, { content: '失败写入', occurredAt: '2026-09-25T09:00:00.000Z' }));

  assert.deepEqual(received, [['entries', 'metadata']]);
});

test('bulk coordinate backfill commits all locations and publishes one refresh', async (t) => {
  const db = createTestDatabase();
  await migrateDatabase(db);
  t.after(() => db.close());
  const firstId = await createEntry(db, { content: '甲地', occurredAt: '2026-09-25T08:00:00.000Z', locationName: '甲地' });
  const secondId = await createEntry(db, { content: '乙地', occurredAt: '2026-09-25T09:00:00.000Z', locationName: '乙地' });
  const received = [];
  const unsubscribe = subscribeToJournalDataChanges((domains) => received.push([...domains].sort()));
  t.after(unsubscribe);

  await applyCoordinatesToLocations(db, [
    { locationName: '甲地', latitude: 31.2304, longitude: 121.4737 },
    { locationName: '乙地', latitude: 39.9042, longitude: 116.4074 },
  ]);

  const [first, second] = await Promise.all([getEntry(db, firstId), getEntry(db, secondId)]);
  assert.equal(first?.latitude, 31.2304);
  assert.equal(first?.longitude, 121.4737);
  assert.equal(second?.latitude, 39.9042);
  assert.equal(second?.longitude, 116.4074);
  assert.deepEqual(received, [['drafts', 'entries', 'metadata']]);
});
