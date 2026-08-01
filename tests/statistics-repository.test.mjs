import assert from 'node:assert/strict';
import test from 'node:test';

import { migrateDatabase } from '../src/database/migrate.ts';
import {
  getAnnualReviewMoments,
  getStatisticsOverview,
  getStatisticsRange,
  getStatisticsYearOptions,
  getStatisticsYearHeatmap,
} from '../src/database/statistics-repository.ts';
import { createTestDatabase } from './sqlite-test-adapter.mjs';

function localIso(year, month, day, hour = 12) {
  return new Date(year, month - 1, day, hour).toISOString();
}

async function setup() {
  const db = createTestDatabase();
  await migrateDatabase(db);
  return db;
}

async function insertEntry(db, {
  id,
  occurredAt,
  mood = null,
  location = null,
  deletedAt = null,
  content = `正文-${id}`,
  createdAt = occurredAt,
}) {
  await db.runAsync(
    `INSERT INTO entries (
      id, content, occurred_at, created_at, updated_at, deleted_at, mood, location_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, content, occurredAt, createdAt, createdAt, deletedAt, mood, location,
  );
}

test('period ranges use local natural week, month and year boundaries', () => {
  const anchor = new Date(2026, 6, 15, 16, 30);
  const week = getStatisticsRange('week', anchor);
  const previousMonth = getStatisticsRange('month', anchor, -1);
  const year = getStatisticsRange('year', anchor);

  assert.equal(new Date(week.start).getDay(), 1);
  assert.equal(new Date(week.start).getDate(), 13);
  assert.equal(new Date(week.end).getDate(), 20);
  assert.equal(new Date(previousMonth.start).getMonth(), 5);
  assert.equal(new Date(previousMonth.end).getMonth(), 6);
  assert.equal(new Date(year.start).getMonth(), 0);
  assert.equal(new Date(year.end).getFullYear(), 2027);
});

test('monthly overview aggregates totals, rankings, trend and previous comparison', async (t) => {
  const db = await setup();
  t.after(() => db.close());

  await insertEntry(db, {
    id: 'current-1',
    occurredAt: localIso(2026, 7, 3),
    createdAt: localIso(2026, 7, 3, 23),
    content: '今天走了很远',
    mood: '开心',
    location: '北京',
  });
  await insertEntry(db, {
    id: 'current-2',
    occurredAt: localIso(2026, 7, 4),
    createdAt: localIso(2026, 7, 4, 9),
    content: '短句',
    mood: '开心',
    location: '上海',
  });
  await insertEntry(db, {
    id: 'previous-1',
    occurredAt: localIso(2026, 6, 10),
    mood: '平静',
    location: '北京',
  });
  await insertEntry(db, {
    id: 'deleted',
    occurredAt: localIso(2026, 7, 5),
    mood: '难过',
    location: '广州',
    deletedAt: localIso(2026, 7, 6),
  });

  await db.runAsync(
    'INSERT INTO entry_images (id, entry_id, uri, created_at) VALUES (?, ?, ?, ?)',
    'media-1', 'current-1', 'file:///1.jpg', localIso(2026, 7, 3),
  );
  await db.runAsync(
    'INSERT INTO follow_ups (id, entry_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    'follow-1', 'current-1', '后续', localIso(2026, 7, 8), localIso(2026, 7, 8),
  );
  await db.runAsync(
    'INSERT INTO follow_up_images (id, follow_up_id, uri, created_at) VALUES (?, ?, ?, ?)',
    'follow-media-1', 'follow-1', 'file:///2.jpg', localIso(2026, 7, 8),
  );
  await db.runAsync(
    'INSERT INTO entry_tags (entry_id, label, sort_order) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)',
    'current-1', '散步', 0,
    'current-2', '散步', 0,
    'current-2', '朋友', 1,
  );

  const result = await getStatisticsOverview(db, {
    period: 'month',
    anchor: new Date(2026, 6, 15),
  });

  assert.deepEqual(result.current.totals, {
    entries: 2,
    media: 2,
    followUps: 1,
    tags: 3,
    locations: 2,
    moods: 2,
  });
  assert.deepEqual(result.current.unique, { tags: 2, locations: 2, moods: 1 });
  assert.deepEqual(result.current.rankings.tags[0], { label: '散步', count: 2 });
  assert.deepEqual(result.current.rankings.moods[0], { label: '开心', count: 2 });
  assert.equal(result.current.highlights.totalCharacters, 8);
  assert.equal(result.current.highlights.latestWritingTime, '23:00');
  assert.deepEqual(result.current.highlights.busiestDay, {
    key: '2026-07-03',
    count: 1,
  });
  assert.deepEqual(result.current.highlights.longestEntry, {
    occurredAt: localIso(2026, 7, 3),
    characters: 6,
  });
  assert.equal(result.current.trend.length, 31);
  assert.equal(result.current.trend.find((item) => item.key.endsWith('-03')).entries, 1);
  assert.equal(result.current.trend.find((item) => item.key.endsWith('-08')).media, 1);
  assert.equal(result.previous.totals.entries, 1);
  assert.deepEqual(result.comparison.entries, {
    current: 2,
    previous: 1,
    difference: 1,
    percentChange: 100,
  });
});

test('comparison reports null percentage when previous period is zero', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  await insertEntry(db, {
    id: 'only-current',
    occurredAt: localIso(2026, 7, 14),
  });
  const result = await getStatisticsOverview(db, {
    period: 'week',
    anchor: new Date(2026, 6, 15),
  });
  assert.equal(result.current.trend.length, 7);
  assert.equal(result.comparison.entries.percentChange, null);
  assert.equal(result.comparison.media.percentChange, 0);
});

test('year overview groups records into natural-month trend buckets', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  await insertEntry(db, {
    id: 'january-entry',
    occurredAt: localIso(2026, 1, 12),
  });
  await insertEntry(db, {
    id: 'july-entry',
    occurredAt: localIso(2026, 7, 24),
  });

  const result = await getStatisticsOverview(db, {
    period: 'year',
    anchor: new Date(2026, 6, 28),
  });

  assert.equal(result.current.totals.entries, 2);
  assert.equal(result.current.trend.length, 12);
  assert.equal(result.current.trend[0].entries, 1);
  assert.equal(result.current.trend[6].entries, 1);
  assert.equal(
    result.current.trend.reduce((total, item) => total + item.entries, 0),
    2,
  );
});

test('year heatmap returns every local day and excludes deleted records', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  await insertEntry(db, {
    id: 'heatmap-entry',
    occurredAt: localIso(2026, 2, 3),
  });
  await insertEntry(db, {
    id: 'deleted-heatmap-entry',
    occurredAt: localIso(2026, 2, 3),
    deletedAt: localIso(2026, 2, 4),
  });

  const heatmap = await getStatisticsYearHeatmap(db, new Date(2026, 6, 28));

  assert.equal(heatmap.length, 365);
  assert.deepEqual(heatmap.find((item) => item.key === '2026-02-03'), {
    key: '2026-02-03',
    count: 1,
  });
});

test('annual review offers continuous years including empty years', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  await insertEntry(db, { id: 'old-year', occurredAt: localIso(2024, 5, 1) });
  const options = await getStatisticsYearOptions(db);
  assert.equal(options[0].year, 2024);
  assert.equal(options[0].count, 1);
  assert.equal(options.at(-1).year, new Date().getFullYear());
  assert.equal(options.find((item) => item.year === 2025).count, 0);
});

test('annual review selects distinct representative moments', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  await insertEntry(db, { id: 'first', occurredAt: localIso(2026, 1, 2), content: '新年开始' });
  await insertEntry(db, { id: 'media-rich', occurredAt: localIso(2026, 2, 2), content: '照片的一天' });
  await insertEntry(db, { id: 'longest', occurredAt: localIso(2026, 3, 2), content: '很长的一段记录内容' });
  await db.runAsync(
    'INSERT INTO entry_images (id, entry_id, uri, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
    'media-a', 'media-rich', 'file:///a.jpg', localIso(2026, 2, 2),
    'media-b', 'media-rich', 'file:///b.jpg', localIso(2026, 2, 2),
  );

  const moments = await getAnnualReviewMoments(db, new Date(2026, 6, 1));
  assert.deepEqual(moments.map((item) => [item.id, item.label]), [
    ['first', '年初一刻'], ['media-rich', '影像最多'], ['longest', '最长记录'],
  ]);
  assert.equal(new Set(moments.map((item) => item.id)).size, moments.length);
});
