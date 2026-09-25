import assert from 'node:assert/strict';
import test from 'node:test';

import { createEntry, listEntryPage } from '../src/database/journal-repository.ts';
import { migrateDatabase } from '../src/database/migrate.ts';
import { encodeEntryDateRange, formatEntryDateRange, parseEntryDateRange, parseLocalDateKey } from '../src/utils/entry-time-range.ts';
import { createTestDatabase } from './sqlite-test-adapter.mjs';

test('custom entry ranges reject invalid dates and reversed boundaries', () => {
  assert.equal(parseLocalDateKey('2026-02-29'), null);
  assert.equal(parseLocalDateKey('2026-2-01'), null);
  assert.equal(parseEntryDateRange('range:2026-09-25:2026-09-24'), null);
  assert.equal(parseEntryDateRange('range:2026-09-24:2026-09-25:extra'), null);
  assert.deepEqual(parseEntryDateRange('range:2026-09-24:2026-09-25'), { start: '2026-09-24', end: '2026-09-25' });
  assert.equal(formatEntryDateRange('range:2026-09-24:2026-09-25'), '2026.09.24 — 2026.09.25');
});

test('custom entry ranges include both local boundary days', async (t) => {
  const db = createTestDatabase();
  await migrateDatabase(db);
  t.after(() => db.close());
  const localIso = (year, month, day, hour) => new Date(year, month - 1, day, hour).toISOString();
  await createEntry(db, { content: '范围之前', occurredAt: localIso(2026, 9, 23, 23) });
  await createEntry(db, { content: '开始当天', occurredAt: localIso(2026, 9, 24, 0) });
  await createEntry(db, { content: '结束当天', occurredAt: localIso(2026, 9, 25, 23) });
  await createEntry(db, { content: '范围之后', occurredAt: localIso(2026, 9, 26, 0) });

  const page = await listEntryPage(db, {
    filters: { time: encodeEntryDateRange('2026-09-24', '2026-09-25') },
    limit: 20,
  });

  assert.deepEqual(page.entries.map((entry) => entry.content).sort(), ['开始当天', '结束当天']);
});
