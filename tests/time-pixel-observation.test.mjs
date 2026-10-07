import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPixelGroups, buildPixelSections, hasTimePixelRangeOnDate, labelForPixelGroup } from '../src/utils/time-pixel-display.ts';
import { timePixelSaveImpact } from '../src/utils/time-pixel-impact.ts';
import { migrateDatabase } from '../src/database/migrate.ts';
import { createTimePixelCategory, getTimePixelSnapshot, initializeTimePixels, saveTimePixelRange } from '../src/database/time-pixel-repository.ts';
import { createTestDatabase } from './sqlite-test-adapter.mjs';

const settings = { originDate: '2023-12-30', rangeMode: 'all', selectedYear: null, unit: 'day', colorMode: 'location', updatedAt: '' };
const range = (id, startDate, endDate, extra = {}) => ({ id, startDate, endDate, kind: 'location', categoryId: 'home', note: null, createdAt: '2025-01-01', updatedAt: '2025-01-01', ...extra });
const snapshot = (ranges) => ({ settings, categories: [], ranges });

test('day sections break at the year boundary without losing or duplicating pixels', () => {
  const built = buildPixelGroups(snapshot([]), settings, '2024-01-02');
  const sections = buildPixelSections(built.groups, 'day', 20);
  assert.deepEqual(sections.map((item) => [item.year, item.data.length, item.data[0].length]), [[2023, 1, 2], [2024, 1, 2]]);
  assert.deepEqual(sections.flatMap((section) => section.data.flat()), built.groups);
  assert.equal(built.elapsedDays, 4);
});

test('month sections retain year labels and year view retains compact multi-year rows', () => {
  const months = buildPixelGroups(snapshot([]), { ...settings, unit: 'month' }, '2025-02-01');
  assert.deepEqual(buildPixelSections(months.groups, 'month', 6).map((item) => [item.title, item.data.map((row) => row.length)]), [
    ['2023年', [1]], ['2024年', [6, 6]], ['2025年', [2]],
  ]);
  const years = buildPixelGroups(snapshot([]), { ...settings, unit: 'year' }, '2025-02-01');
  const overview = buildPixelSections(years.groups, 'year', 4);
  assert.equal(overview.length, 1);
  assert.equal(overview[0].title, '年份总览');
  assert.equal(overview[0].year, null);
  assert.deepEqual(overview[0].data[0].map((item) => item.key), ['2023', '2024', '2025']);
  assert.deepEqual(buildPixelSections([], 'day', 20), []);
  assert.throws(() => buildPixelSections([], 'day', 0));
});

test('a selected year remains visible before the observation start', () => {
  const early = range('school', '2015-09-01', '2015-09-02');
  const built = buildPixelGroups(snapshot([early]), { ...settings, originDate: '2020-01-01', rangeMode: 'year', selectedYear: 2015, unit: 'month' }, '2026-10-04');
  assert.deepEqual(built.bounds, { start: '2015-01-01', end: '2015-12-31' });
  assert.equal(built.recordedDays, 2);
});

test('note presence spans its full range in either layer', () => {
  const ranges = [range('home', '2023-12-30', '2024-01-01', { note: '回家' }), range('stage', '2024-01-01', '2024-01-03', { kind: 'stage', note: '上学' })];
  for (const colorMode of ['location', 'stage']) {
    const built = buildPixelGroups(snapshot(ranges), { ...settings, colorMode }, '2024-01-04');
    assert.deepEqual(built.groups.map((item) => item.hasNote), [true, true, true, true, true, false]);
  }
});

test('day labels mark only the first day of each month', () => {
  assert.equal(labelForPixelGroup({ key: '2025-01-01', startDate: '2025-01-01' }, 'day'), '1');
  assert.equal(labelForPixelGroup({ key: '2025-10-01', startDate: '2025-10-01' }, 'day'), '10');
  assert.equal(labelForPixelGroup({ key: '2025-10-02', startDate: '2025-10-02' }, 'day'), '');
  assert.equal(labelForPixelGroup({ key: '2025-10', startDate: '2025-10-01' }, 'month'), '10月');
  assert.equal(labelForPixelGroup({ key: '2025', startDate: '2025-01-01' }, 'year'), '2025');
});

test('a day is considered recorded only in the active layer', () => {
  const ranges = [range('school', '2025-01-01', '2025-01-02', { kind: 'stage', categoryId: 'school' })];
  assert.equal(hasTimePixelRangeOnDate(ranges, 'location', '2025-01-01'), false);
  assert.equal(hasTimePixelRangeOnDate(ranges, 'stage', '2025-01-01'), true);
  assert.equal(hasTimePixelRangeOnDate(ranges, 'stage', '2025-01-03'), false);
});

test('coarse note presence aggregates only visible elapsed days, including leap day', () => {
  const ranges = [range('note', '2024-02-29', '2024-02-29', { note: '闰日' }), range('blank', '2024-01-01', '2024-01-31', { note: '  ' }), range('future', '2024-04-01', '2024-04-02', { kind: 'stage', note: '尚未发生' })];
  const selected = { ...settings, rangeMode: 'year', selectedYear: 2024, unit: 'month' };
  const built = buildPixelGroups(snapshot(ranges), selected, '2024-03-01');
  assert.deepEqual(built.groups.filter((item) => item.hasNote).map((item) => item.key), ['2024-02']);
  assert.equal(built.elapsedDays, 61);
  assert.equal(built.futureDays, 305);
  const years = buildPixelGroups(snapshot(ranges), { ...selected, unit: 'year' }, '2024-03-01');
  assert.equal(years.groups[0].hasNote, true);
  const independent = buildPixelGroups(snapshot(ranges), { ...selected, originDate: '2024-03-01' }, '2024-03-01');
  assert.equal(independent.groups.some((item) => item.hasNote), true);
});

test('current month and year preserve category counts separately from future days', () => {
  const current = { ...settings, originDate: '2026-01-01', rangeMode: 'year', selectedYear: 2026, unit: 'month' };
  const ranges = [range('home-now', '2026-10-01', '2026-10-02')];
  const october = buildPixelGroups(snapshot(ranges), current, '2026-10-02').groups.find((item) => item.key === '2026-10');
  assert.ok(october);
  assert.equal(october.counts.get('home'), 2);
  assert.equal(october.counts.get('__future'), 29);
  const year = buildPixelGroups(snapshot(ranges), { ...current, unit: 'year' }, '2026-10-02').groups[0];
  assert.equal(year.elapsedDays + year.counts.get('__future'), year.totalDays);
  assert.equal(year.counts.get('__future'), 90);
});

test('overlap preview counts inclusive dates per category, with independent layers and note risks', () => {
  const ranges = [range('a', '2024-02-27', '2024-02-29', { note: '旧备注' }), range('b', '2024-03-01', '2024-03-10', { categoryId: 'dorm' }), range('c', '2024-02-01', '2024-03-31', { kind: 'stage', note: '不受影响' })];
  const impact = timePixelSaveImpact(ranges, { kind: 'location', startDate: '2024-02-28', endDate: '2024-03-02' });
  assert.equal(impact.totalDays, 4);
  assert.equal(impact.overwrittenDays, 4);
  assert.equal(impact.changedNotes, 1);
  assert.equal(impact.removedDays, 0);
  assert.deepEqual(impact.byCategory, [{ categoryId: 'home', days: 2 }, { categoryId: 'dorm', days: 2 }]);
  assert.equal(timePixelSaveImpact(ranges, { kind: 'location', startDate: '2024-02-28', endDate: '2024-03-02', note: '旧备注' }).changedNotes, 0);
});

test('editing excludes itself from overlap confirmation, but warns when dates are removed', () => {
  const original = range('a', '2024-02-01', '2024-02-29', { note: '原备注' });
  const unchanged = timePixelSaveImpact([original], { ...original, note: '修改备注' });
  assert.equal(unchanged.overwrittenDays, 0);
  assert.equal(unchanged.removedDays, 0);
  const shrunk = timePixelSaveImpact([original], { ...original, startDate: '2024-02-02', endDate: '2024-02-28' });
  assert.equal(shrunk.removedDays, 2);
  const moved = timePixelSaveImpact([original], { ...original, startDate: '2024-03-01', endDate: '2024-03-02' });
  assert.equal(moved.removedDays, 29);
  assert.equal(timePixelSaveImpact([original], { kind: 'location', startDate: '2024-03-01', endDate: '2024-03-02' }).overwrittenDays, 0);
});

test('confirmation fingerprints are order independent and detect same-day note changes', () => {
  const ranges = [range('b', '2024-02-10', '2024-02-20'), range('a', '2024-02-01', '2024-02-09')];
  const draft = { kind: 'location', startDate: '2024-02-01', endDate: '2024-02-29' };
  const signature = timePixelSaveImpact(ranges, draft).signature;
  assert.equal(timePixelSaveImpact(ranges.toReversed(), draft).signature, signature);
  assert.notEqual(timePixelSaveImpact([{ ...ranges[0], note: 'new' }, ranges[1]], draft).signature, signature);
});

test('stale confirmation aborts before deleting or splitting any records, and fresh confirmation succeeds', async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  const exclusiveTransaction = db.withExclusiveTransactionAsync;
  let exclusiveWrites = 0;
  db.withExclusiveTransactionAsync = async (callback) => {
    exclusiveWrites += 1;
    return exclusiveTransaction(callback);
  };
  await migrateDatabase(db);
  const now = new Date('2026-01-01T12:00:00Z');
  await initializeTimePixels(db, '2024-01-01', now);
  const categoryId = await createTimePixelCategory(db, { kind: 'location', name: '家', colorToken: 'fern' }, now);
  const id = await saveTimePixelRange(db, { categoryId, startDate: '2024-01-01', endDate: '2024-01-31', note: '原备注' }, now);
  const draft = { categoryId, kind: 'location', startDate: '2024-01-10', endDate: '2024-01-20', note: '新备注' };
  const signature = timePixelSaveImpact((await getTimePixelSnapshot(db)).ranges, draft).signature;
  await saveTimePixelRange(db, { id, categoryId, startDate: '2024-01-01', endDate: '2024-01-31', note: '其他操作刚更新了备注' }, now);
  const before = await getTimePixelSnapshot(db);
  await assert.rejects(() => saveTimePixelRange(db, { ...draft, expectedImpactSignature: signature }, now), /time-pixel-conflict-changed/);
  assert.deepEqual(await getTimePixelSnapshot(db), before);
  await saveTimePixelRange(db, { ...draft, expectedImpactSignature: timePixelSaveImpact(before.ranges, draft).signature }, now);
  assert.equal(exclusiveWrites, 4);
  const after = await getTimePixelSnapshot(db);
  assert.deepEqual(after.ranges.map((item) => [item.startDate, item.endDate, item.note]), [
    ['2024-01-01', '2024-01-09', '其他操作刚更新了备注'],
    ['2024-01-10', '2024-01-20', '新备注'],
    ['2024-01-21', '2024-01-31', '其他操作刚更新了备注'],
  ]);
});

test('new conflicts appearing after an empty preview are also rejected', async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  await migrateDatabase(db);
  const categoryId = await createTimePixelCategory(db, { kind: 'stage', name: '大学', colorToken: 'rose' });
  const draft = { categoryId, kind: 'stage', startDate: '2024-01-01', endDate: '2024-01-31' };
  const signature = timePixelSaveImpact([], draft).signature;
  await saveTimePixelRange(db, draft);
  const before = await getTimePixelSnapshot(db);
  await assert.rejects(() => saveTimePixelRange(db, { ...draft, expectedImpactSignature: signature }), /time-pixel-conflict-changed/);
  assert.deepEqual(await getTimePixelSnapshot(db), before);
});
