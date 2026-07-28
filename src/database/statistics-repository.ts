import type { SQLiteDatabase } from 'expo-sqlite';

export type StatisticsPeriod = 'week' | 'month' | 'year';

export type StatisticsRange = {
  start: string;
  end: string;
};

export type StatisticsTotals = {
  entries: number;
  media: number;
  followUps: number;
  tags: number;
  locations: number;
  moods: number;
};

export type StatisticsUniqueTotals = {
  tags: number;
  locations: number;
  moods: number;
};

export type StatisticsRankingItem = {
  label: string;
  count: number;
};

export type StatisticsTrendItem = {
  key: string;
  entries: number;
  media: number;
  followUps: number;
};

export type StatisticsHeatmapDay = {
  key: string;
  count: number;
};

export type StatisticsHighlights = {
  totalCharacters: number;
  latestWritingTime: string | null;
  busiestDay: {
    key: string;
    count: number;
  } | null;
  longestEntry: {
    occurredAt: string;
    characters: number;
  } | null;
};

export type StatisticsSnapshot = {
  period: StatisticsPeriod;
  range: StatisticsRange;
  totals: StatisticsTotals;
  unique: StatisticsUniqueTotals;
  rankings: {
    tags: StatisticsRankingItem[];
    locations: StatisticsRankingItem[];
    moods: StatisticsRankingItem[];
  };
  highlights: StatisticsHighlights;
  trend: StatisticsTrendItem[];
};

export type StatisticsMetricComparison = {
  current: number;
  previous: number;
  difference: number;
  percentChange: number | null;
};

export type StatisticsOverview = {
  current: StatisticsSnapshot;
  previous: StatisticsSnapshot;
  comparison: Record<keyof StatisticsTotals, StatisticsMetricComparison>;
};

type TotalRow = StatisticsTotals & {
  uniqueTags: number;
  uniqueLocations: number;
  uniqueMoods: number;
};
type RankingRow = { label: string; count: number };
type TrendRow = { bucket: string; count: number };
type HighlightSummaryRow = {
  totalCharacters: number;
  latestWritingTime: string | null;
};
type BusiestDayRow = { key: string; count: number };
type LongestEntryRow = { occurredAt: string; characters: number };

const TOTAL_KEYS: (keyof StatisticsTotals)[] = [
  'entries',
  'media',
  'followUps',
  'tags',
  'locations',
  'moods',
];

function startOfLocalDay(value: Date) {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function getStatisticsRange(
  period: StatisticsPeriod,
  anchor: Date = new Date(),
  offset = 0,
): StatisticsRange {
  if (!Number.isInteger(offset)) {
    throw new Error('统计周期偏移量必须是整数');
  }
  const start = startOfLocalDay(anchor);
  if (period === 'week') {
    const mondayOffset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - mondayOffset + offset * 7);
  } else if (period === 'month') {
    start.setDate(1);
    start.setMonth(start.getMonth() + offset);
  } else {
    start.setMonth(0, 1);
    start.setFullYear(start.getFullYear() + offset);
  }

  const end = new Date(start);
  if (period === 'week') end.setDate(end.getDate() + 7);
  else if (period === 'month') end.setMonth(end.getMonth() + 1);
  else end.setFullYear(end.getFullYear() + 1);

  return { start: start.toISOString(), end: end.toISOString() };
}

function getTrendKeys(period: StatisticsPeriod, range: StatisticsRange) {
  const keys: string[] = [];
  const cursor = new Date(range.start);
  const end = new Date(range.end);
  while (cursor < end) {
    if (period === 'year') {
      keys.push(
        `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`,
      );
      cursor.setMonth(cursor.getMonth() + 1);
    } else {
      keys.push(
        `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`,
      );
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return keys;
}

function mapRanking(rows: RankingRow[]): StatisticsRankingItem[] {
  return rows.map((row) => ({ label: row.label, count: Number(row.count) }));
}

function mapTrend(rows: TrendRow[]) {
  return new Map(rows.map((row) => [row.bucket, Number(row.count)]));
}

async function getSnapshot(
  db: SQLiteDatabase,
  period: StatisticsPeriod,
  range: StatisticsRange,
  rankingLimit: number,
): Promise<StatisticsSnapshot> {
  const bucketFormat = period === 'year' ? '%Y-%m' : '%Y-%m-%d';
  const params = [range.start, range.end] as const;

  const [
    totalRow,
    tagRows,
    locationRows,
    moodRows,
    highlightSummaryRow,
    busiestDayRow,
    longestEntryRow,
    entryTrendRows,
    entryMediaTrendRows,
    followUpTrendRows,
    followUpMediaTrendRows,
  ] = await Promise.all([
    db.getFirstAsync<TotalRow>(
      `SELECT
        (SELECT COUNT(*) FROM entries e
          WHERE e.deleted_at IS NULL AND e.occurred_at >= ? AND e.occurred_at < ?) AS entries,
        ((SELECT COUNT(*) FROM entry_images i
          INNER JOIN entries e ON e.id = i.entry_id
          WHERE e.deleted_at IS NULL AND e.occurred_at >= ? AND e.occurred_at < ?)
        + (SELECT COUNT(*) FROM follow_up_images i
          INNER JOIN follow_ups f ON f.id = i.follow_up_id
          INNER JOIN entries e ON e.id = f.entry_id
          WHERE e.deleted_at IS NULL AND f.deleted_at IS NULL
            AND f.created_at >= ? AND f.created_at < ?)) AS media,
        (SELECT COUNT(*) FROM follow_ups f
          INNER JOIN entries e ON e.id = f.entry_id
          WHERE e.deleted_at IS NULL AND f.deleted_at IS NULL
            AND f.created_at >= ? AND f.created_at < ?) AS followUps,
        (SELECT COUNT(*) FROM entry_tags t
          INNER JOIN entries e ON e.id = t.entry_id
          WHERE e.deleted_at IS NULL AND e.occurred_at >= ? AND e.occurred_at < ?) AS tags,
        (SELECT COUNT(*) FROM entries e
          WHERE e.deleted_at IS NULL AND e.occurred_at >= ? AND e.occurred_at < ?
            AND e.location_name IS NOT NULL AND TRIM(e.location_name) != '') AS locations,
        (SELECT COUNT(*) FROM entries e
          WHERE e.deleted_at IS NULL AND e.occurred_at >= ? AND e.occurred_at < ?
            AND e.mood IS NOT NULL AND TRIM(e.mood) != '') AS moods,
        (SELECT COUNT(DISTINCT t.label) FROM entry_tags t
          INNER JOIN entries e ON e.id = t.entry_id
          WHERE e.deleted_at IS NULL AND e.occurred_at >= ? AND e.occurred_at < ?) AS uniqueTags,
        (SELECT COUNT(DISTINCT e.location_name) FROM entries e
          WHERE e.deleted_at IS NULL AND e.occurred_at >= ? AND e.occurred_at < ?
            AND e.location_name IS NOT NULL AND TRIM(e.location_name) != '') AS uniqueLocations,
        (SELECT COUNT(DISTINCT e.mood) FROM entries e
          WHERE e.deleted_at IS NULL AND e.occurred_at >= ? AND e.occurred_at < ?
            AND e.mood IS NOT NULL AND TRIM(e.mood) != '') AS uniqueMoods`,
      range.start, range.end,
      range.start, range.end,
      range.start, range.end,
      range.start, range.end,
      range.start, range.end,
      range.start, range.end,
      range.start, range.end,
      range.start, range.end,
      range.start, range.end,
      range.start, range.end,
    ),
    db.getAllAsync<RankingRow>(
      `SELECT t.label, COUNT(*) AS count
       FROM entry_tags t INNER JOIN entries e ON e.id = t.entry_id
       WHERE e.deleted_at IS NULL AND e.occurred_at >= ? AND e.occurred_at < ?
       GROUP BY t.label ORDER BY count DESC, t.label COLLATE NOCASE LIMIT ?`,
      ...params, rankingLimit,
    ),
    db.getAllAsync<RankingRow>(
      `SELECT e.location_name AS label, COUNT(*) AS count
       FROM entries e
       WHERE e.deleted_at IS NULL AND e.occurred_at >= ? AND e.occurred_at < ?
         AND e.location_name IS NOT NULL AND TRIM(e.location_name) != ''
       GROUP BY e.location_name ORDER BY count DESC, label COLLATE NOCASE LIMIT ?`,
      ...params, rankingLimit,
    ),
    db.getAllAsync<RankingRow>(
      `SELECT e.mood AS label, COUNT(*) AS count
       FROM entries e
       WHERE e.deleted_at IS NULL AND e.occurred_at >= ? AND e.occurred_at < ?
         AND e.mood IS NOT NULL AND TRIM(e.mood) != ''
       GROUP BY e.mood ORDER BY count DESC, label COLLATE NOCASE LIMIT ?`,
      ...params, rankingLimit,
    ),
    db.getFirstAsync<HighlightSummaryRow>(
      `SELECT
        COALESCE(SUM(LENGTH(e.content)), 0) AS totalCharacters,
        MAX(strftime('%H:%M', e.created_at, 'localtime')) AS latestWritingTime
       FROM entries e
       WHERE e.deleted_at IS NULL AND e.occurred_at >= ? AND e.occurred_at < ?`,
      ...params,
    ),
    db.getFirstAsync<BusiestDayRow>(
      `SELECT strftime('%Y-%m-%d', e.occurred_at, 'localtime') AS key, COUNT(*) AS count
       FROM entries e
       WHERE e.deleted_at IS NULL AND e.occurred_at >= ? AND e.occurred_at < ?
       GROUP BY key ORDER BY count DESC, key ASC LIMIT 1`,
      ...params,
    ),
    db.getFirstAsync<LongestEntryRow>(
      `SELECT e.occurred_at AS occurredAt, LENGTH(e.content) AS characters
       FROM entries e
       WHERE e.deleted_at IS NULL AND e.occurred_at >= ? AND e.occurred_at < ?
       ORDER BY characters DESC, e.occurred_at ASC LIMIT 1`,
      ...params,
    ),
    db.getAllAsync<TrendRow>(
      `SELECT strftime('${bucketFormat}', e.occurred_at, 'localtime') AS bucket, COUNT(*) AS count
       FROM entries e
       WHERE e.deleted_at IS NULL AND e.occurred_at >= ? AND e.occurred_at < ?
       GROUP BY bucket ORDER BY bucket`,
      ...params,
    ),
    db.getAllAsync<TrendRow>(
      `SELECT strftime('${bucketFormat}', e.occurred_at, 'localtime') AS bucket, COUNT(*) AS count
       FROM entry_images i INNER JOIN entries e ON e.id = i.entry_id
       WHERE e.deleted_at IS NULL AND e.occurred_at >= ? AND e.occurred_at < ?
       GROUP BY bucket ORDER BY bucket`,
      ...params,
    ),
    db.getAllAsync<TrendRow>(
      `SELECT strftime('${bucketFormat}', f.created_at, 'localtime') AS bucket, COUNT(*) AS count
       FROM follow_ups f INNER JOIN entries e ON e.id = f.entry_id
       WHERE e.deleted_at IS NULL AND f.deleted_at IS NULL
         AND f.created_at >= ? AND f.created_at < ?
       GROUP BY bucket ORDER BY bucket`,
      ...params,
    ),
    db.getAllAsync<TrendRow>(
      `SELECT strftime('${bucketFormat}', f.created_at, 'localtime') AS bucket, COUNT(*) AS count
       FROM follow_up_images i
       INNER JOIN follow_ups f ON f.id = i.follow_up_id
       INNER JOIN entries e ON e.id = f.entry_id
       WHERE e.deleted_at IS NULL AND f.deleted_at IS NULL
         AND f.created_at >= ? AND f.created_at < ?
       GROUP BY bucket ORDER BY bucket`,
      ...params,
    ),
  ]);

  const totals: StatisticsTotals = {
    entries: Number(totalRow?.entries ?? 0),
    media: Number(totalRow?.media ?? 0),
    followUps: Number(totalRow?.followUps ?? 0),
    tags: Number(totalRow?.tags ?? 0),
    locations: Number(totalRow?.locations ?? 0),
    moods: Number(totalRow?.moods ?? 0),
  };
  const entryTrend = mapTrend(entryTrendRows);
  const entryMediaTrend = mapTrend(entryMediaTrendRows);
  const followUpTrend = mapTrend(followUpTrendRows);
  const followUpMediaTrend = mapTrend(followUpMediaTrendRows);

  return {
    period,
    range,
    totals,
    unique: {
      tags: Number(totalRow?.uniqueTags ?? 0),
      locations: Number(totalRow?.uniqueLocations ?? 0),
      moods: Number(totalRow?.uniqueMoods ?? 0),
    },
    rankings: {
      tags: mapRanking(tagRows),
      locations: mapRanking(locationRows),
      moods: mapRanking(moodRows),
    },
    highlights: {
      totalCharacters: Number(highlightSummaryRow?.totalCharacters ?? 0),
      latestWritingTime: highlightSummaryRow?.latestWritingTime ?? null,
      busiestDay: busiestDayRow
        ? { key: busiestDayRow.key, count: Number(busiestDayRow.count) }
        : null,
      longestEntry: longestEntryRow
        ? {
          occurredAt: longestEntryRow.occurredAt,
          characters: Number(longestEntryRow.characters),
        }
        : null,
    },
    trend: getTrendKeys(period, range).map((key) => ({
      key,
      entries: entryTrend.get(key) ?? 0,
      media: (entryMediaTrend.get(key) ?? 0) + (followUpMediaTrend.get(key) ?? 0),
      followUps: followUpTrend.get(key) ?? 0,
    })),
  };
}

function compareTotals(current: StatisticsTotals, previous: StatisticsTotals) {
  return Object.fromEntries(TOTAL_KEYS.map((key) => {
    const difference = current[key] - previous[key];
    return [key, {
      current: current[key],
      previous: previous[key],
      difference,
      percentChange: previous[key] === 0
        ? (current[key] === 0 ? 0 : null)
        : (difference / previous[key]) * 100,
    }];
  })) as Record<keyof StatisticsTotals, StatisticsMetricComparison>;
}

export async function getStatisticsOverview(
  db: SQLiteDatabase,
  options: {
    period: StatisticsPeriod;
    anchor?: Date;
    rankingLimit?: number;
  },
): Promise<StatisticsOverview> {
  const rankingLimit = Math.max(1, Math.min(options.rankingLimit ?? 8, 50));
  const currentRange = getStatisticsRange(options.period, options.anchor, 0);
  const previousRange = getStatisticsRange(options.period, options.anchor, -1);
  const [current, previous] = await Promise.all([
    getSnapshot(db, options.period, currentRange, rankingLimit),
    getSnapshot(db, options.period, previousRange, rankingLimit),
  ]);
  return {
    current,
    previous,
    comparison: compareTotals(current.totals, previous.totals),
  };
}

export async function getStatisticsYearHeatmap(
  db: SQLiteDatabase,
  anchor: Date = new Date(),
): Promise<StatisticsHeatmapDay[]> {
  const range = getStatisticsRange('year', anchor);
  const rows = await db.getAllAsync<TrendRow>(
    `SELECT strftime('%Y-%m-%d', e.occurred_at, 'localtime') AS bucket, COUNT(*) AS count
     FROM entries e
     WHERE e.deleted_at IS NULL AND e.occurred_at >= ? AND e.occurred_at < ?
     GROUP BY bucket ORDER BY bucket`,
    range.start,
    range.end,
  );
  const counts = mapTrend(rows);
  return getTrendKeys('month', range).map((key) => ({
    key,
    count: counts.get(key) ?? 0,
  }));
}
