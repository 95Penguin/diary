import type { SQLiteDatabase } from 'expo-sqlite';
import { localDateKey } from '../utils/entry-time-range.ts';
import { timePixelSaveImpact } from '../utils/time-pixel-impact.ts';
import { isTimePixelDate, mergeTimePixelRanges, normalizeTimePixelSettings } from '../utils/time-pixels.ts';

export type TimePixelKind = 'location' | 'stage';
export type TimePixelUnit = 'year' | 'month' | 'day';
export type TimePixelRangeMode = 'all' | 'year';

export type TimePixelCategory = {
  id: string;
  kind: TimePixelKind;
  name: string;
  colorToken: string;
  createdAt: string;
  updatedAt: string;
};

export type TimePixelRange = {
  id: string;
  kind: TimePixelKind;
  categoryId: string;
  startDate: string;
  endDate: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TimePixelSettings = {
  originDate: string;
  rangeMode: TimePixelRangeMode;
  selectedYear: number | null;
  unit: TimePixelUnit;
  colorMode: TimePixelKind;
  updatedAt: string;
};

export type TimePixelSnapshot = {
  settings: TimePixelSettings | null;
  categories: TimePixelCategory[];
  ranges: TimePixelRange[];
};

type CategoryRow = { id: string; kind: TimePixelKind; name: string; color_token: string; created_at: string; updated_at: string };
type RangeRow = { id: string; kind: TimePixelKind; category_id: string; start_date: string; end_date: string; note: string | null; created_at: string; updated_at: string };
type SettingsRow = { origin_date: string; range_mode: TimePixelRangeMode; selected_year: number | null; unit: TimePixelUnit; color_mode: TimePixelKind; updated_at: string };

function createId(prefix: string) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
function shiftedDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function withTimePixelWriteTransaction(db: SQLiteDatabase, task: (txn: SQLiteDatabase) => Promise<void>) {
  // Expo's ordinary async transaction can absorb unrelated queries that happen
  // while it is open. Use an exclusive transaction on native so the conflict
  // signature and the following range rewrite are one uninterrupted operation.
  if (typeof document === 'undefined') {
    await db.withExclusiveTransactionAsync(async (txn) => task(txn as SQLiteDatabase));
    return;
  }
  // withExclusiveTransactionAsync is not supported by expo-sqlite on web.
  await db.withTransactionAsync(() => task(db));
}

function categoryFromRow(row: CategoryRow): TimePixelCategory {
  return { id: row.id, kind: row.kind, name: row.name, colorToken: row.color_token, createdAt: row.created_at, updatedAt: row.updated_at };
}
function rangeFromRow(row: RangeRow): TimePixelRange {
  return { id: row.id, kind: row.kind, categoryId: row.category_id, startDate: row.start_date, endDate: row.end_date, note: row.note, createdAt: row.created_at, updatedAt: row.updated_at };
}
function settingsFromRow(row: SettingsRow): TimePixelSettings {
  return { originDate: row.origin_date, rangeMode: row.range_mode, selectedYear: row.selected_year, unit: row.unit, colorMode: row.color_mode, updatedAt: row.updated_at };
}

export async function getTimePixelSnapshot(db: SQLiteDatabase): Promise<TimePixelSnapshot> {
  const [settings, categoryRows, rangeRows] = await Promise.all([
    db.getFirstAsync<SettingsRow>('SELECT origin_date, range_mode, selected_year, unit, color_mode, updated_at FROM time_pixel_settings WHERE id = 1'),
    db.getAllAsync<CategoryRow>('SELECT id, kind, name, color_token, created_at, updated_at FROM time_pixel_categories ORDER BY kind, created_at, name'),
    db.getAllAsync<RangeRow>('SELECT id, kind, category_id, start_date, end_date, note, created_at, updated_at FROM time_pixel_ranges ORDER BY start_date, end_date, created_at'),
  ]);
  return {
    settings: settings ? normalizeTimePixelSettings(settingsFromRow(settings), localDateKey(new Date())) : null,
    categories: categoryRows.map(categoryFromRow),
    ranges: rangeRows.map(rangeFromRow),
  };
}

export async function initializeTimePixels(db: SQLiteDatabase, originDate: string, now = new Date()) {
  if (!isTimePixelDate(originDate) || originDate > localDateKey(now)) throw new Error('invalid-origin-date');
  const updatedAt = now.toISOString();
  await db.runAsync(
    `INSERT INTO time_pixel_settings (id, origin_date, range_mode, selected_year, unit, color_mode, updated_at)
     VALUES (1, ?, 'all', NULL, 'month', 'location', ?)
     ON CONFLICT(id) DO UPDATE SET origin_date = excluded.origin_date, updated_at = excluded.updated_at,
       range_mode = CASE WHEN selected_year < CAST(substr(excluded.origin_date, 1, 4) AS INTEGER) THEN 'all' ELSE range_mode END,
       selected_year = CASE WHEN selected_year < CAST(substr(excluded.origin_date, 1, 4) AS INTEGER) THEN NULL ELSE selected_year END`,
    originDate, updatedAt,
  );
}

export async function saveTimePixelPreferences(
  db: SQLiteDatabase,
  input: Partial<Pick<TimePixelSettings, 'rangeMode' | 'selectedYear' | 'unit' | 'colorMode'>>,
  now = new Date(),
) {
  if ((input.rangeMode !== undefined && !['all', 'year'].includes(input.rangeMode)) || (input.unit !== undefined && !['year', 'month', 'day'].includes(input.unit)) || (input.colorMode !== undefined && !['location', 'stage'].includes(input.colorMode))) throw new Error('invalid-time-pixel-preferences');
  if (input.rangeMode === 'year' && (!Number.isInteger(input.selectedYear) || (input.selectedYear ?? 0) < 1900 || (input.selectedYear ?? 0) > now.getFullYear())) throw new Error('invalid-selected-year');
  if (input.selectedYear !== undefined && input.rangeMode === undefined) throw new Error('invalid-selected-year');
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (input.unit !== undefined) { fields.push('unit = ?'); values.push(input.unit); }
  if (input.colorMode !== undefined) { fields.push('color_mode = ?'); values.push(input.colorMode); }
  if (input.rangeMode !== undefined) {
    fields.push('range_mode = ?', 'selected_year = ?');
    values.push(input.rangeMode, input.rangeMode === 'year' ? input.selectedYear! : null);
  }
  if (!fields.length) return;
  const selectedYear = input.rangeMode === 'year' ? input.selectedYear! : null;
  const result = await db.runAsync(
    `UPDATE time_pixel_settings SET ${fields.join(', ')}, updated_at = ? WHERE id = 1
     AND (? IS NULL OR ? >= CAST(substr(origin_date, 1, 4) AS INTEGER))`,
    ...values, now.toISOString(), selectedYear, selectedYear,
  );
  if (!result.changes) throw new Error('invalid-time-pixel-preferences');
}

export async function createTimePixelCategory(
  db: SQLiteDatabase,
  input: { kind: TimePixelKind; name: string; colorToken: string },
  now = new Date(),
) {
  const name = input.name.trim();
  if (!name || name.length > 30 || !['location', 'stage'].includes(input.kind) || !input.colorToken.trim()) throw new Error('invalid-category');
  const duplicate = await db.getFirstAsync<{ id: string }>('SELECT id FROM time_pixel_categories WHERE kind = ? AND lower(name) = lower(?)', input.kind, name);
  if (duplicate) throw new Error('duplicate-category');
  const id = createId('pixel-category');
  const timestamp = now.toISOString();
  await db.runAsync(
    'INSERT INTO time_pixel_categories (id, kind, name, color_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    id, input.kind, name, input.colorToken, timestamp, timestamp,
  );
  return id;
}

export async function updateTimePixelCategory(
  db: SQLiteDatabase,
  id: string,
  input: { name: string; colorToken: string },
  now = new Date(),
) {
  const name = input.name.trim();
  if (!name || name.length > 30 || !input.colorToken.trim()) throw new Error('invalid-category');
  const category = await db.getFirstAsync<{ kind: TimePixelKind }>('SELECT kind FROM time_pixel_categories WHERE id = ?', id);
  if (!category) throw new Error('category-not-found');
  const duplicate = await db.getFirstAsync<{ id: string }>('SELECT id FROM time_pixel_categories WHERE kind = ? AND lower(name) = lower(?) AND id != ?', category.kind, name, id);
  if (duplicate) throw new Error('duplicate-category');
  await db.runAsync('UPDATE time_pixel_categories SET name = ?, color_token = ?, updated_at = ? WHERE id = ?', name, input.colorToken, now.toISOString(), id);
}

export async function saveTimePixelRange(
  db: SQLiteDatabase,
  input: { categoryId: string; startDate: string; endDate: string; note?: string | null; id?: string; expectedImpactSignature?: string },
  now = new Date(),
) {
  if (!isTimePixelDate(input.startDate) || !isTimePixelDate(input.endDate) || input.startDate > input.endDate) throw new Error('invalid-date-range');
  const timestamp = now.toISOString();
  const id = input.id ?? createId('pixel-range');
  await withTimePixelWriteTransaction(db, async (txn) => {
    const category = await txn.getFirstAsync<{ kind: TimePixelKind }>('SELECT kind FROM time_pixel_categories WHERE id = ?', input.categoryId);
    if (!category) throw new Error('category-not-found');
    if (input.expectedImpactSignature !== undefined) {
      const affected = await txn.getAllAsync<RangeRow>(
        'SELECT * FROM time_pixel_ranges WHERE (kind = ? AND start_date <= ? AND end_date >= ?) OR id = ?',
        category.kind, input.endDate, input.startDate, input.id ?? '',
      );
      const impact = timePixelSaveImpact(affected.map(rangeFromRow), { ...input, kind: category.kind });
      if (impact.signature !== input.expectedImpactSignature) throw new Error('time-pixel-conflict-changed');
    }
    if (input.id) await txn.runAsync('DELETE FROM time_pixel_ranges WHERE id = ?', input.id);
    const overlaps = await txn.getAllAsync<RangeRow>(
      `SELECT id, kind, category_id, start_date, end_date, note, created_at, updated_at
       FROM time_pixel_ranges WHERE kind = ? AND start_date <= ? AND end_date >= ?`,
      category.kind, input.endDate, input.startDate,
    );
    for (const overlap of overlaps) {
      const keepLeft = overlap.start_date < input.startDate;
      const keepRight = overlap.end_date > input.endDate;
      if (keepLeft && keepRight) {
        await txn.runAsync('UPDATE time_pixel_ranges SET end_date = ?, updated_at = ? WHERE id = ?', shiftedDate(input.startDate, -1), timestamp, overlap.id);
        await txn.runAsync(
          'INSERT INTO time_pixel_ranges (id, kind, category_id, start_date, end_date, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          createId('pixel-range'), overlap.kind, overlap.category_id, shiftedDate(input.endDate, 1), overlap.end_date, overlap.note, overlap.created_at, timestamp,
        );
      } else if (keepLeft) {
        await txn.runAsync('UPDATE time_pixel_ranges SET end_date = ?, updated_at = ? WHERE id = ?', shiftedDate(input.startDate, -1), timestamp, overlap.id);
      } else if (keepRight) {
        await txn.runAsync('UPDATE time_pixel_ranges SET start_date = ?, updated_at = ? WHERE id = ?', shiftedDate(input.endDate, 1), timestamp, overlap.id);
      } else {
        await txn.runAsync('DELETE FROM time_pixel_ranges WHERE id = ?', overlap.id);
      }
    }
    await txn.runAsync(
      'INSERT INTO time_pixel_ranges (id, kind, category_id, start_date, end_date, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, category.kind, input.categoryId, input.startDate, input.endDate, input.note?.trim() || null, timestamp, timestamp,
    );
  });
  return id;
}

export async function deleteTimePixelRange(db: SQLiteDatabase, id: string) {
  await db.runAsync('DELETE FROM time_pixel_ranges WHERE id = ?', id);
}

// The caller owns the surrounding restore transaction.
export async function mergeRestoredTimePixelRanges(db: SQLiteDatabase, incoming: TimePixelRange[]) {
  const rows = await db.getAllAsync<RangeRow>('SELECT * FROM time_pixel_ranges');
  const merged = mergeTimePixelRanges(rows.map(rangeFromRow), incoming);
  const retained = new Set(merged.map((range) => range.id));
  for (const row of rows) {
    if (!retained.has(row.id)) await db.runAsync('DELETE FROM time_pixel_ranges WHERE id = ?', row.id);
  }
  for (const range of merged) await db.runAsync(
    `INSERT INTO time_pixel_ranges (id, kind, category_id, start_date, end_date, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, category_id = excluded.category_id, start_date = excluded.start_date,
       end_date = excluded.end_date, note = excluded.note, created_at = excluded.created_at, updated_at = excluded.updated_at`,
    range.id, range.kind, range.categoryId, range.startDate, range.endDate, range.note, range.createdAt, range.updatedAt,
  );
}
