import type { SQLiteDatabase } from 'expo-sqlite';
import type { DeletedEntry, Draft, DraftImage, Entry, EntryImage, EntryInput, EntryVersion, FollowUp, FollowUpImage, ImportResult, JournalBackup, JournalMediaType, JournalStats, SearchResult } from '@/domain/journal';

type EntryRow = { id: string; content: string; occurred_at: string; created_at: string; updated_at: string; mood: string | null; weather: string | null; favorited_at: string | null; location_name: string | null; latitude: number | null; longitude: number | null };
type FollowUpRow = { id: string; entry_id: string; content: string; created_at: string; updated_at: string };
type ImageRow = { id: string; entry_id: string; uri: string; width: number; height: number; sort_order: number; media_type: JournalMediaType; paired_video_uri: string | null; duration: number | null; thumbnail_uri: string | null };
type TagRow = { entry_id: string; label: string };
type DeletedEntryRow = EntryRow & { deleted_at: string };
export type EntryFilterKind = 'none' | 'time' | 'location' | 'tag' | 'mood' | 'weather';
export type EntryListFilter = { kind: EntryFilterKind; value: string | null };
export type EntryPageCursor = { occurredAt: string; createdAt: string; id: string };
export type EntryPage = { entries: Entry[]; nextCursor: EntryPageCursor | null };
export type EntryFilterOptions = { locations: string[]; tags: string[]; moods: string[]; weather: string[] };

function createId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
function mapFollowUp(row: FollowUpRow, images: FollowUpImage[] = []): FollowUp {
  return { id: row.id, entryId: row.entry_id, content: row.content, createdAt: row.created_at, updatedAt: row.updated_at, images };
}

async function attachFollowUps(db: SQLiteDatabase, rows: EntryRow[]): Promise<Entry[]> {
  if (!rows.length) return [];
  const placeholders = rows.map(() => '?').join(', ');
  const followUpRows = await db.getAllAsync<FollowUpRow>(
    `SELECT id, entry_id, content, created_at, updated_at FROM follow_ups
     WHERE deleted_at IS NULL AND entry_id IN (${placeholders}) ORDER BY created_at ASC`,
    rows.map((row) => row.id),
  );
  const followUpImageRows = followUpRows.length ? await db.getAllAsync<{ id: string; follow_up_id: string; uri: string; width: number; height: number; sort_order: number; media_type: JournalMediaType; paired_video_uri: string | null; duration: number | null; thumbnail_uri: string | null }>(
    `SELECT id, follow_up_id, uri, width, height, sort_order, media_type, paired_video_uri, duration, thumbnail_uri FROM follow_up_images
     WHERE follow_up_id IN (${followUpRows.map(() => '?').join(', ')}) ORDER BY sort_order ASC`,
    followUpRows.map((row) => row.id),
  ) : [];
  const imagesByFollowUp = new Map<string, FollowUpImage[]>();
  for (const image of followUpImageRows) {
    const items = imagesByFollowUp.get(image.follow_up_id) ?? [];
    items.push({ id: image.id, followUpId: image.follow_up_id, uri: image.uri, width: image.width, height: image.height, sortOrder: image.sort_order, mediaType: image.media_type, pairedVideoUri: image.paired_video_uri, duration: image.duration, thumbnailUri: image.thumbnail_uri });
    imagesByFollowUp.set(image.follow_up_id, items);
  }
  const byEntry = new Map<string, FollowUp[]>();
  for (const row of followUpRows) {
    const items = byEntry.get(row.entry_id) ?? [];
    items.push(mapFollowUp(row, imagesByFollowUp.get(row.id) ?? []));
    byEntry.set(row.entry_id, items);
  }
  const imageRows = await db.getAllAsync<ImageRow>(
    `SELECT id, entry_id, uri, width, height, sort_order, media_type, paired_video_uri, duration, thumbnail_uri FROM entry_images
     WHERE entry_id IN (${placeholders}) ORDER BY sort_order ASC`,
    rows.map((row) => row.id),
  );
  const imagesByEntry = new Map<string, EntryImage[]>();
  for (const row of imageRows) {
    const items = imagesByEntry.get(row.entry_id) ?? [];
    items.push({ id: row.id, entryId: row.entry_id, uri: row.uri, width: row.width, height: row.height, sortOrder: row.sort_order, mediaType: row.media_type, pairedVideoUri: row.paired_video_uri, duration: row.duration, thumbnailUri: row.thumbnail_uri });
    imagesByEntry.set(row.entry_id, items);
  }
  const tagRows = await db.getAllAsync<TagRow>(
    `SELECT entry_id, label FROM entry_tags WHERE entry_id IN (${placeholders}) ORDER BY sort_order ASC`,
    rows.map((row) => row.id),
  );
  const tagsByEntry = new Map<string, string[]>();
  for (const row of tagRows) {
    const items = tagsByEntry.get(row.entry_id) ?? [];
    items.push(row.label);
    tagsByEntry.set(row.entry_id, items);
  }
  return rows.map((row) => ({
    id: row.id, content: row.content, occurredAt: row.occurred_at, createdAt: row.created_at,
    updatedAt: row.updated_at, mood: row.mood, weather: row.weather, favoritedAt: row.favorited_at, locationName: row.location_name, latitude: row.latitude, longitude: row.longitude,
    followUps: byEntry.get(row.id) ?? [], images: imagesByEntry.get(row.id) ?? [], tags: tagsByEntry.get(row.id) ?? [],
  }));
}

export async function listEntries(db: SQLiteDatabase, query = ''): Promise<Entry[]> {
  const keyword = query.trim();
  const params: string[] = [];
  let where = 'e.deleted_at IS NULL';
  if (keyword) {
    where += ` AND (e.content LIKE ? ESCAPE '\\' OR EXISTS (
      SELECT 1 FROM follow_ups f WHERE f.entry_id = e.id AND f.deleted_at IS NULL
      AND f.content LIKE ? ESCAPE '\\') OR EXISTS (
      SELECT 1 FROM entry_tags t WHERE t.entry_id = e.id AND t.label LIKE ? ESCAPE '\\'))`;
    const escaped = keyword.replace(/[\\%_]/g, '\\$&');
    params.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
  }
  const rows = await db.getAllAsync<EntryRow>(
    `SELECT e.id, e.content, e.occurred_at, e.created_at, e.updated_at, e.mood, e.weather, e.favorited_at, e.location_name, e.latitude, e.longitude FROM entries e
     WHERE ${where} ORDER BY e.occurred_at DESC, e.created_at DESC`, params,
  );
  return attachFollowUps(db, rows);
}

function startOfLocalDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result.toISOString();
}

function appendEntryFilter(where: string[], params: (string | number)[], filter?: EntryListFilter) {
  if (!filter?.value || filter.kind === 'none') return;
  if (filter.kind === 'location') {
    where.push('e.location_name = ?');
    params.push(filter.value);
  } else if (filter.kind === 'tag') {
    where.push('EXISTS (SELECT 1 FROM entry_tags t WHERE t.entry_id = e.id AND t.label = ?)');
    params.push(filter.value);
  } else if (filter.kind === 'mood') {
    where.push('e.mood = ?');
    params.push(filter.value);
  } else if (filter.kind === 'weather') {
    where.push('e.weather = ?');
    params.push(filter.value);
  } else if (filter.kind === 'time') {
    const now = new Date();
    let start: Date | null = null;
    let end: Date | null = null;
    if (filter.value === 'today') {
      start = new Date(startOfLocalDay(now));
      end = new Date(start);
      end.setDate(end.getDate() + 1);
    } else if (filter.value === '7days' || filter.value === '30days') {
      start = new Date(startOfLocalDay(now));
      start.setDate(start.getDate() - (filter.value === '7days' ? 6 : 29));
    } else if (filter.value === 'year') {
      start = new Date(now.getFullYear(), 0, 1);
      end = new Date(now.getFullYear() + 1, 0, 1);
    }
    if (start) {
      where.push('e.occurred_at >= ?');
      params.push(start.toISOString());
    }
    if (end) {
      where.push('e.occurred_at < ?');
      params.push(end.toISOString());
    }
  }
}

export async function listEntryPage(
  db: SQLiteDatabase,
  options: { limit?: number; cursor?: EntryPageCursor | null; filter?: EntryListFilter } = {},
): Promise<EntryPage> {
  const limit = Math.max(1, Math.min(options.limit ?? 30, 100));
  const where = ['e.deleted_at IS NULL'];
  const params: (string | number)[] = [];
  appendEntryFilter(where, params, options.filter);
  if (options.cursor) {
    where.push(`(
      e.occurred_at < ? OR
      (e.occurred_at = ? AND e.created_at < ?) OR
      (e.occurred_at = ? AND e.created_at = ? AND e.id < ?)
    )`);
    params.push(
      options.cursor.occurredAt,
      options.cursor.occurredAt,
      options.cursor.createdAt,
      options.cursor.occurredAt,
      options.cursor.createdAt,
      options.cursor.id,
    );
  }
  params.push(limit + 1);
  const rows = await db.getAllAsync<EntryRow>(
    `SELECT e.id, e.content, e.occurred_at, e.created_at, e.updated_at, e.mood, e.weather,
       e.favorited_at, e.location_name, e.latitude, e.longitude
     FROM entries e
     WHERE ${where.join(' AND ')}
     ORDER BY e.occurred_at DESC, e.created_at DESC, e.id DESC
     LIMIT ?`,
    params,
  );
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const entries = await attachFollowUps(db, pageRows);
  const last = pageRows.at(-1);
  return {
    entries,
    nextCursor: hasMore && last
      ? { occurredAt: last.occurred_at, createdAt: last.created_at, id: last.id }
      : null,
  };
}

export async function listEntryFilterOptions(db: SQLiteDatabase): Promise<EntryFilterOptions> {
  const [locations, tags, moods, weather] = await Promise.all([
    db.getAllAsync<{ value: string }>(`SELECT DISTINCT location_name AS value FROM entries
      WHERE deleted_at IS NULL AND location_name IS NOT NULL AND location_name != '' ORDER BY value COLLATE NOCASE`),
    db.getAllAsync<{ value: string }>(`SELECT t.label AS value FROM entry_tags t
      INNER JOIN entries e ON e.id = t.entry_id WHERE e.deleted_at IS NULL
      GROUP BY t.label ORDER BY COUNT(*) DESC, t.label COLLATE NOCASE`),
    db.getAllAsync<{ value: string }>(`SELECT DISTINCT mood AS value FROM entries
      WHERE deleted_at IS NULL AND mood IS NOT NULL AND mood != '' ORDER BY value COLLATE NOCASE`),
    db.getAllAsync<{ value: string }>(`SELECT DISTINCT weather AS value FROM entries
      WHERE deleted_at IS NULL AND weather IS NOT NULL AND weather != '' ORDER BY value COLLATE NOCASE`),
  ]);
  return {
    locations: locations.map((row) => row.value),
    tags: tags.map((row) => row.value),
    moods: moods.map((row) => row.value),
    weather: weather.map((row) => row.value),
  };
}

export async function listCalendarMonthCounts(
  db: SQLiteDatabase,
  start: string,
  end: string,
): Promise<Record<string, number>> {
  const rows = await db.getAllAsync<{ occurred_at: string }>(
    `SELECT occurred_at FROM entries
     WHERE deleted_at IS NULL AND occurred_at >= ? AND occurred_at < ?`,
    start,
    end,
  );
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const value = new Date(row.occurred_at);
    const key = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export async function listEntriesForDate(db: SQLiteDatabase, date: string): Promise<Entry[]> {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const rows = await db.getAllAsync<EntryRow>(
    `SELECT id, content, occurred_at, created_at, updated_at, mood, weather, favorited_at,
       location_name, latitude, longitude
     FROM entries WHERE deleted_at IS NULL AND occurred_at >= ? AND occurred_at < ?
     ORDER BY occurred_at ASC, created_at ASC, id ASC`,
    start.toISOString(),
    end.toISOString(),
  );
  return attachFollowUps(db, rows);
}

export async function searchEntries(
  db: SQLiteDatabase,
  query: string,
  range?: { start: string; end: string },
): Promise<SearchResult[]> {
  const keyword = query.trim();
  if (!keyword) return [];
  const escaped = keyword.replace(/[\\%_]/g, '\\$&');
  const like = `%${escaped}%`;
  const params: string[] = [like, like, like];
  let dateWhere = '';
  if (range) {
    dateWhere = ' AND e.occurred_at >= ? AND e.occurred_at < ?';
    params.push(range.start, range.end);
  }
  const rows = await db.getAllAsync<EntryRow>(
    `SELECT e.id, e.content, e.occurred_at, e.created_at, e.updated_at, e.mood, e.weather, e.favorited_at, e.location_name, e.latitude, e.longitude FROM entries e
     WHERE e.deleted_at IS NULL AND (e.content LIKE ? ESCAPE '\\' OR EXISTS (
       SELECT 1 FROM follow_ups f WHERE f.entry_id = e.id AND f.deleted_at IS NULL
       AND f.content LIKE ? ESCAPE '\\') OR EXISTS (
       SELECT 1 FROM entry_tags t WHERE t.entry_id = e.id AND t.label LIKE ? ESCAPE '\\'))
       ${dateWhere}
     ORDER BY e.occurred_at DESC, e.created_at DESC`, params,
  );
  const entries = await attachFollowUps(db, rows);
  const normalized = keyword.toLocaleLowerCase();
  return entries.map((entry) => {
    const sources: SearchResult['sources'] = [];
    if (entry.content.toLocaleLowerCase().includes(normalized)) sources.push('content');
    const matchingFollowUp = entry.followUps.find((item) => item.content.toLocaleLowerCase().includes(normalized))?.content;
    if (matchingFollowUp) sources.push('followUp');
    const matchingTag = entry.tags.find((tag) => tag.toLocaleLowerCase().includes(normalized));
    if (matchingTag) sources.push('tag');
    return { entry, sources, matchingFollowUp, matchingTag };
  });
}

export async function getEntry(db: SQLiteDatabase, id: string): Promise<Entry | null> {
  const row = await db.getFirstAsync<EntryRow>(
    'SELECT id, content, occurred_at, created_at, updated_at, mood, weather, favorited_at, location_name, latitude, longitude FROM entries WHERE id = ? AND deleted_at IS NULL', id,
  );
  if (!row) return null;
  return (await attachFollowUps(db, [row]))[0];
}

export async function createEntry(db: SQLiteDatabase, input: EntryInput): Promise<string> {
  const id = createId(); const now = new Date().toISOString();
  await db.runAsync(
    'INSERT INTO entries (id, content, occurred_at, created_at, updated_at, mood, weather, location_name, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, input.content.trim(), input.occurredAt, now, now, input.mood ?? null, input.weather ?? null, input.locationName?.trim() || null, input.latitude ?? null, input.longitude ?? null,
  );
  return id;
}

type EntryAssetInput = { uri: string; width: number; height: number; mediaType?: JournalMediaType; pairedVideoUri?: string | null; duration?: number | null; thumbnailUri?: string | null };

export async function createEntryWithDetails(
  db: SQLiteDatabase,
  input: EntryInput,
  images: EntryAssetInput[],
  tags: string[],
): Promise<string> {
  const id = createId(); const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      'INSERT INTO entries (id, content, occurred_at, created_at, updated_at, mood, weather, location_name, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, input.content.trim(), input.occurredAt, now, now, input.mood ?? null, input.weather ?? null,
      input.locationName?.trim() || null, input.latitude ?? null, input.longitude ?? null,
    );
    for (const [index, image] of images.entries()) await txn.runAsync(
      'INSERT INTO entry_images (id, entry_id, uri, width, height, sort_order, created_at, media_type, paired_video_uri, duration, thumbnail_uri) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      createId(), id, image.uri, image.width, image.height, index, now, image.mediaType ?? 'image', image.pairedVideoUri ?? null, image.duration ?? null, image.thumbnailUri ?? null,
    );
    for (const [index, label] of tags.entries()) await txn.runAsync(
      'INSERT INTO entry_tags (entry_id, label, sort_order) VALUES (?, ?, ?)', id, label, index,
    );
  });
  return id;
}

export async function updateEntry(db: SQLiteDatabase, id: string, input: EntryInput) {
  // Read and persist the old value on the database's primary connection. On
  // Android, preparing read statements on expo-sqlite's temporary exclusive
  // connection can lose the NativeStatement shared-object reference.
  await snapshotEntry(db, id);
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      'UPDATE entries SET content = ?, occurred_at = ?, mood = ?, weather = ?, location_name = ?, latitude = ?, longitude = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
      input.content.trim(), input.occurredAt, input.mood ?? null, input.weather ?? null, input.locationName?.trim() || null, input.latitude ?? null, input.longitude ?? null, new Date().toISOString(), id,
    );
  });
}

export async function updateEntryWithDetails(
  db: SQLiteDatabase,
  id: string,
  input: EntryInput,
  images: EntryAssetInput[],
  tags: string[],
): Promise<string[]> {
  const existing = await db.getAllAsync<{ uri: string }>(
    `SELECT uri FROM entry_images WHERE entry_id = ?
     UNION ALL SELECT paired_video_uri AS uri FROM entry_images WHERE entry_id = ? AND paired_video_uri IS NOT NULL
     UNION ALL SELECT thumbnail_uri AS uri FROM entry_images WHERE entry_id = ? AND thumbnail_uri IS NOT NULL`,
    id, id, id,
  );
  const keptUris = new Set(images.flatMap((image) => [image.uri, image.pairedVideoUri, image.thumbnailUri].filter((uri): uri is string => Boolean(uri))));
  await snapshotEntry(db, id);
  await db.withExclusiveTransactionAsync(async (txn) => {
    const now = new Date().toISOString();
    await txn.runAsync(
      'UPDATE entries SET content = ?, occurred_at = ?, mood = ?, weather = ?, location_name = ?, latitude = ?, longitude = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
      input.content.trim(), input.occurredAt, input.mood ?? null, input.weather ?? null,
      input.locationName?.trim() || null, input.latitude ?? null, input.longitude ?? null, now, id,
    );
    await txn.runAsync('DELETE FROM entry_images WHERE entry_id = ?', id);
    for (const [index, image] of images.entries()) await txn.runAsync(
      'INSERT INTO entry_images (id, entry_id, uri, width, height, sort_order, created_at, media_type, paired_video_uri, duration, thumbnail_uri) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      createId(), id, image.uri, image.width, image.height, index, now, image.mediaType ?? 'image', image.pairedVideoUri ?? null, image.duration ?? null, image.thumbnailUri ?? null,
    );
    await txn.runAsync('DELETE FROM entry_tags WHERE entry_id = ?', id);
    for (const [index, label] of tags.entries()) await txn.runAsync(
      'INSERT INTO entry_tags (entry_id, label, sort_order) VALUES (?, ?, ?)', id, label, index,
    );
  });
  return existing.filter((image) => !keptUris.has(image.uri)).map((image) => image.uri);
}

async function snapshotEntry(db: SQLiteDatabase, entryId: string) {
  const entry = await db.getFirstAsync<EntryRow>('SELECT id, content, occurred_at, created_at, updated_at, mood, weather, favorited_at, location_name, latitude, longitude FROM entries WHERE id = ? AND deleted_at IS NULL', entryId);
  if (!entry) return;
  const tags = await db.getAllAsync<{ label: string }>('SELECT label FROM entry_tags WHERE entry_id = ? ORDER BY sort_order ASC', entryId);
  await db.runAsync(
    `INSERT INTO entry_versions (id, entry_id, content, occurred_at, mood, weather, location_name, latitude, longitude, tags_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    createId(), entryId, entry.content, entry.occurred_at, entry.mood, entry.weather, entry.location_name,
    entry.latitude, entry.longitude, JSON.stringify(tags.map((tag) => tag.label)), new Date().toISOString(),
  );
  const expired = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM entry_versions WHERE entry_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET 50', entryId,
  );
  for (const version of expired) await db.runAsync('DELETE FROM entry_versions WHERE id = ?', version.id);
}

type EntryVersionRow = { id: string; entry_id: string; content: string; occurred_at: string; mood: string | null; weather: string | null; location_name: string | null; latitude: number | null; longitude: number | null; tags_json: string; created_at: string };

function mapEntryVersion(row: EntryVersionRow): EntryVersion {
  return { id: row.id, entryId: row.entry_id, content: row.content, occurredAt: row.occurred_at, mood: row.mood,
    weather: row.weather, locationName: row.location_name, latitude: row.latitude, longitude: row.longitude,
    tags: parseJsonArray<string>(row.tags_json), createdAt: row.created_at };
}

export async function listEntryVersions(db: SQLiteDatabase, entryId: string): Promise<EntryVersion[]> {
  const rows = await db.getAllAsync<EntryVersionRow>(
    `SELECT id, entry_id, content, occurred_at, mood, weather, location_name, latitude, longitude, tags_json, created_at
     FROM entry_versions WHERE entry_id = ? ORDER BY created_at DESC`, entryId,
  );
  return rows.map(mapEntryVersion);
}

export async function restoreEntryVersion(db: SQLiteDatabase, versionId: string) {
  const version = await db.getFirstAsync<EntryVersionRow>(
    `SELECT id, entry_id, content, occurred_at, mood, weather, location_name, latitude, longitude, tags_json, created_at
     FROM entry_versions WHERE id = ?`, versionId,
  );
  if (!version) return false;
  const tags = parseJsonArray<string>(version.tags_json);
  await snapshotEntry(db, version.entry_id);
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `UPDATE entries SET content = ?, occurred_at = ?, mood = ?, weather = ?, location_name = ?, latitude = ?, longitude = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
      version.content, version.occurred_at, version.mood, version.weather, version.location_name, version.latitude, version.longitude, new Date().toISOString(), version.entry_id,
    );
    await txn.runAsync('DELETE FROM entry_tags WHERE entry_id = ?', version.entry_id);
    for (const [index, label] of tags.entries()) await txn.runAsync('INSERT INTO entry_tags (entry_id, label, sort_order) VALUES (?, ?, ?)', version.entry_id, label, index);
  });
  return true;
}

export async function listFavoriteEntries(db: SQLiteDatabase): Promise<Entry[]> {
  const rows = await db.getAllAsync<EntryRow>(
    `SELECT id, content, occurred_at, created_at, updated_at, mood, weather, favorited_at, location_name, latitude, longitude FROM entries
     WHERE deleted_at IS NULL AND favorited_at IS NOT NULL ORDER BY favorited_at DESC`,
  );
  return attachFollowUps(db, rows);
}

export async function setEntryFavorite(db: SQLiteDatabase, id: string, favorite: boolean) {
  await db.runAsync('UPDATE entries SET favorited_at = ? WHERE id = ? AND deleted_at IS NULL', favorite ? new Date().toISOString() : null, id);
}

export async function listSuppressedMemoryEntryIds(db: SQLiteDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ entry_id: string }>('SELECT entry_id FROM memory_suppressed_entries');
  return rows.map((row) => row.entry_id);
}

export async function suppressMemoryEntry(db: SQLiteDatabase, entryId: string) {
  await db.runAsync(
    'INSERT OR REPLACE INTO memory_suppressed_entries (entry_id, suppressed_at) VALUES (?, ?)',
    entryId, new Date().toISOString(),
  );
}

export async function deleteEntry(db: SQLiteDatabase, id: string) {
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('UPDATE entries SET deleted_at = ?, updated_at = ? WHERE id = ?', now, now, id);
    await txn.runAsync('UPDATE follow_ups SET deleted_at = ?, updated_at = ? WHERE entry_id = ?', now, now, id);
  });
  return [];
}

export async function listDeletedEntries(db: SQLiteDatabase): Promise<DeletedEntry[]> {
  const rows = await db.getAllAsync<DeletedEntryRow>(
    `SELECT id, content, occurred_at, created_at, updated_at, mood, weather, favorited_at, location_name, latitude, longitude, deleted_at FROM entries
     WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
  );
  const attached = await attachFollowUps(db, rows);
  return attached.map((entry, index) => ({ ...entry, deletedAt: rows[index].deleted_at }));
}

export async function restoreEntry(db: SQLiteDatabase, id: string) {
  const row = await db.getFirstAsync<{ deleted_at: string }>('SELECT deleted_at FROM entries WHERE id = ? AND deleted_at IS NOT NULL', id);
  if (!row) return;
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('UPDATE entries SET deleted_at = NULL, updated_at = ? WHERE id = ?', now, id);
    await txn.runAsync('UPDATE follow_ups SET deleted_at = NULL, updated_at = ? WHERE entry_id = ? AND deleted_at = ?', now, id, row.deleted_at);
  });
}

export async function permanentlyDeleteEntry(db: SQLiteDatabase, id: string) {
  const images = await db.getAllAsync<{ uri: string }>(
    `SELECT uri FROM entry_images WHERE entry_id = ?
     UNION ALL SELECT paired_video_uri AS uri FROM entry_images WHERE entry_id = ? AND paired_video_uri IS NOT NULL
     UNION ALL SELECT thumbnail_uri AS uri FROM entry_images WHERE entry_id = ? AND thumbnail_uri IS NOT NULL
     UNION ALL
     SELECT i.uri FROM follow_up_images i JOIN follow_ups f ON f.id = i.follow_up_id WHERE f.entry_id = ?
     UNION ALL
     SELECT i.paired_video_uri AS uri FROM follow_up_images i JOIN follow_ups f ON f.id = i.follow_up_id WHERE f.entry_id = ? AND i.paired_video_uri IS NOT NULL
     UNION ALL
     SELECT i.thumbnail_uri AS uri FROM follow_up_images i JOIN follow_ups f ON f.id = i.follow_up_id WHERE f.entry_id = ? AND i.thumbnail_uri IS NOT NULL`,
    id, id, id, id, id, id,
  );
  await db.runAsync('DELETE FROM entries WHERE id = ? AND deleted_at IS NOT NULL', id);
  return images.map((image) => image.uri);
}

export async function cleanupExpiredTrash(db: SQLiteDatabase, retentionDays = 30) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const images = await db.getAllAsync<{ uri: string }>(
    `SELECT i.uri FROM entry_images i JOIN entries e ON e.id = i.entry_id
     WHERE e.deleted_at IS NOT NULL AND e.deleted_at < ?
     UNION ALL
     SELECT i.paired_video_uri AS uri FROM entry_images i JOIN entries e ON e.id = i.entry_id
     WHERE e.deleted_at IS NOT NULL AND e.deleted_at < ? AND i.paired_video_uri IS NOT NULL
     UNION ALL
     SELECT i.thumbnail_uri AS uri FROM entry_images i JOIN entries e ON e.id = i.entry_id
     WHERE e.deleted_at IS NOT NULL AND e.deleted_at < ? AND i.thumbnail_uri IS NOT NULL
     UNION ALL
     SELECT i.uri FROM follow_up_images i
     JOIN follow_ups f ON f.id = i.follow_up_id
     JOIN entries e ON e.id = f.entry_id
     WHERE e.deleted_at IS NOT NULL AND e.deleted_at < ?
     UNION ALL
     SELECT i.paired_video_uri AS uri FROM follow_up_images i
     JOIN follow_ups f ON f.id = i.follow_up_id
     JOIN entries e ON e.id = f.entry_id
     WHERE e.deleted_at IS NOT NULL AND e.deleted_at < ? AND i.paired_video_uri IS NOT NULL
     UNION ALL
     SELECT i.thumbnail_uri AS uri FROM follow_up_images i
     JOIN follow_ups f ON f.id = i.follow_up_id
     JOIN entries e ON e.id = f.entry_id
     WHERE e.deleted_at IS NOT NULL AND e.deleted_at < ? AND i.thumbnail_uri IS NOT NULL`,
    cutoff, cutoff, cutoff, cutoff, cutoff, cutoff,
  );
  await db.runAsync('DELETE FROM entries WHERE deleted_at IS NOT NULL AND deleted_at < ?', cutoff);
  return images.map((image) => image.uri);
}

export async function getJournalStats(db: SQLiteDatabase): Promise<JournalStats> {
  const row = await db.getFirstAsync<JournalStats>(`
    SELECT
      (SELECT COUNT(*) FROM entries WHERE deleted_at IS NULL) AS entries,
      (SELECT COUNT(*) FROM follow_ups WHERE deleted_at IS NULL) AS followUps,
      ((SELECT COUNT(*) FROM entry_images i JOIN entries e ON e.id = i.entry_id WHERE e.deleted_at IS NULL)
       + (SELECT COUNT(*) FROM follow_up_images i
          JOIN follow_ups f ON f.id = i.follow_up_id
          JOIN entries e ON e.id = f.entry_id
          WHERE e.deleted_at IS NULL AND f.deleted_at IS NULL)) AS images,
      (SELECT COUNT(*) FROM entries WHERE deleted_at IS NOT NULL) AS deleted
  `);
  return row ?? { entries: 0, followUps: 0, images: 0, deleted: 0 };
}

export async function createJournalExport(db: SQLiteDatabase): Promise<JournalBackup> {
  const entries = await db.getAllAsync<{
    id: string; content: string; occurred_at: string; created_at: string; updated_at: string; mood: string | null; weather: string | null; favorited_at: string | null; location_name: string | null; latitude: number | null; longitude: number | null; deleted_at: string | null;
  }>('SELECT id, content, occurred_at, created_at, updated_at, mood, weather, favorited_at, location_name, latitude, longitude, deleted_at FROM entries ORDER BY occurred_at ASC');
  const followUps = await db.getAllAsync<{
    id: string; entry_id: string; content: string; created_at: string; updated_at: string; deleted_at: string | null;
  }>('SELECT id, entry_id, content, created_at, updated_at, deleted_at FROM follow_ups ORDER BY created_at ASC');
  const images = await db.getAllAsync<{
    id: string; entry_id: string; uri: string; width: number; height: number; sort_order: number; created_at: string; media_type: JournalMediaType; paired_video_uri: string | null; duration: number | null; thumbnail_uri: string | null;
  }>('SELECT id, entry_id, uri, width, height, sort_order, created_at, media_type, paired_video_uri, duration, thumbnail_uri FROM entry_images ORDER BY entry_id, sort_order ASC');
  const followUpImages = await db.getAllAsync<{
    id: string; follow_up_id: string; uri: string; width: number; height: number; sort_order: number; created_at: string; media_type: JournalMediaType; paired_video_uri: string | null; duration: number | null; thumbnail_uri: string | null;
  }>('SELECT id, follow_up_id, uri, width, height, sort_order, created_at, media_type, paired_video_uri, duration, thumbnail_uri FROM follow_up_images ORDER BY follow_up_id, sort_order ASC');
  const tags = await db.getAllAsync<{ entry_id: string; label: string; sort_order: number }>(
    'SELECT entry_id, label, sort_order FROM entry_tags ORDER BY entry_id, sort_order ASC',
  );
  const versions = await db.getAllAsync<EntryVersionRow>(
    `SELECT id, entry_id, content, occurred_at, mood, weather, location_name, latitude, longitude, tags_json, created_at
     FROM entry_versions ORDER BY entry_id, created_at ASC`,
  );
  const suppressed = await db.getAllAsync<{ entry_id: string }>('SELECT entry_id FROM memory_suppressed_entries');
  return {
    format: 'shishi-journal',
    version: 9,
    exportedAt: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    entries: entries.map((entry) => ({
      id: entry.id, content: entry.content, occurredAt: entry.occurred_at, createdAt: entry.created_at,
      updatedAt: entry.updated_at, deletedAt: entry.deleted_at, mood: entry.mood, weather: entry.weather, favoritedAt: entry.favorited_at,
      locationName: entry.location_name, latitude: entry.latitude, longitude: entry.longitude,
    })),
    followUps: followUps.map((item) => ({
      id: item.id, entryId: item.entry_id, content: item.content, createdAt: item.created_at,
      updatedAt: item.updated_at, deletedAt: item.deleted_at,
    })),
    images: images.map((image) => ({
      id: image.id, entryId: image.entry_id, localUri: image.uri, width: image.width, height: image.height,
      sortOrder: image.sort_order, createdAt: image.created_at, mediaType: image.media_type,
      pairedVideoLocalUri: image.paired_video_uri, duration: image.duration, thumbnailLocalUri: image.thumbnail_uri,
    })),
    followUpImages: followUpImages.map((image) => ({
      id: image.id, followUpId: image.follow_up_id, localUri: image.uri, width: image.width, height: image.height,
      sortOrder: image.sort_order, createdAt: image.created_at, mediaType: image.media_type,
      pairedVideoLocalUri: image.paired_video_uri, duration: image.duration, thumbnailLocalUri: image.thumbnail_uri,
    })),
    tags: tags.map((tag) => ({ entryId: tag.entry_id, label: tag.label, sortOrder: tag.sort_order })),
    versions: versions.map((version) => ({ id: version.id, entryId: version.entry_id, content: version.content,
      occurredAt: version.occurred_at, mood: version.mood, weather: version.weather, locationName: version.location_name,
      latitude: version.latitude, longitude: version.longitude, tags: parseJsonArray<string>(version.tags_json), createdAt: version.created_at })),
    suppressedMemoryEntryIds: suppressed.map((item) => item.entry_id),
  };
}

export async function getLastExportAt(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM kv_store WHERE key = 'last-export-at'");
  return row?.value ?? null;
}

export async function saveLastExportAt(db: SQLiteDatabase, value: string) {
  await db.runAsync(
    `INSERT INTO kv_store (key, value) VALUES ('last-export-at', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`, value,
  );
}

export async function getFollowUpOrder(db: SQLiteDatabase): Promise<'asc' | 'desc'> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM kv_store WHERE key = 'follow-up-order'");
  return row?.value === 'desc' ? 'desc' : 'asc';
}

export async function saveFollowUpOrder(db: SQLiteDatabase, value: 'asc' | 'desc') {
  await db.runAsync(
    `INSERT INTO kv_store (key, value) VALUES ('follow-up-order', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`, value,
  );
}

export async function getCalendarOrder(db: SQLiteDatabase): Promise<'asc' | 'desc'> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM kv_store WHERE key = 'calendar-entry-order'");
  return row?.value === 'desc' ? 'desc' : 'asc';
}

export async function saveCalendarOrder(db: SQLiteDatabase, value: 'asc' | 'desc') {
  await db.runAsync(
    `INSERT INTO kv_store (key, value) VALUES ('calendar-entry-order', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`, value,
  );
}

export async function importJournalBackup(db: SQLiteDatabase, backup: JournalBackup): Promise<ImportResult> {
  const result: ImportResult = { createdEntries: 0, updatedEntries: 0, createdFollowUps: 0, updatedFollowUps: 0, tags: 0 };
  // Use the primary connection: Android can invalidate prepared statements when
  // reads are mixed into expo-sqlite's temporary exclusive connection.
  await db.withTransactionAsync(async () => {
    const txn = db;
    for (const entry of backup.entries) {
      const existing = await txn.getFirstAsync<{ updated_at: string }>('SELECT updated_at FROM entries WHERE id = ?', entry.id);
      if (!existing) {
        await txn.runAsync(
          'INSERT INTO entries (id, content, occurred_at, created_at, updated_at, deleted_at, mood, weather, favorited_at, location_name, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          entry.id, entry.content, entry.occurredAt, entry.createdAt, entry.updatedAt, entry.deletedAt, entry.mood ?? null, entry.weather ?? null, entry.favoritedAt ?? null, entry.locationName ?? null, entry.latitude ?? null, entry.longitude ?? null,
        );
        result.createdEntries += 1;
      } else if (entry.updatedAt > existing.updated_at) {
        await txn.runAsync(
          'UPDATE entries SET content = ?, occurred_at = ?, updated_at = ?, deleted_at = ?, mood = ?, weather = ?, favorited_at = ?, location_name = ?, latitude = ?, longitude = ? WHERE id = ?',
          entry.content, entry.occurredAt, entry.updatedAt, entry.deletedAt, entry.mood ?? null, entry.weather ?? null, entry.favoritedAt ?? null, entry.locationName ?? null, entry.latitude ?? null, entry.longitude ?? null, entry.id,
        );
        result.updatedEntries += 1;
      }
    }
    for (const item of backup.followUps) {
      const parent = await txn.getFirstAsync<{ id: string }>('SELECT id FROM entries WHERE id = ?', item.entryId);
      if (!parent) continue;
      const existing = await txn.getFirstAsync<{ updated_at: string }>('SELECT updated_at FROM follow_ups WHERE id = ?', item.id);
      if (!existing) {
        await txn.runAsync(
          'INSERT INTO follow_ups (id, entry_id, content, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)',
          item.id, item.entryId, item.content, item.createdAt, item.updatedAt, item.deletedAt,
        );
        result.createdFollowUps += 1;
      } else if (item.updatedAt > existing.updated_at) {
        await txn.runAsync(
          'UPDATE follow_ups SET content = ?, updated_at = ?, deleted_at = ? WHERE id = ?',
          item.content, item.updatedAt, item.deletedAt, item.id,
        );
        result.updatedFollowUps += 1;
      }
    }
    for (const tag of backup.tags) {
      const parent = await txn.getFirstAsync<{ id: string }>('SELECT id FROM entries WHERE id = ?', tag.entryId);
      if (!parent) continue;
      const inserted = await txn.runAsync(
        'INSERT OR IGNORE INTO entry_tags (entry_id, label, sort_order) VALUES (?, ?, ?)',
        tag.entryId, tag.label, tag.sortOrder,
      );
      result.tags += inserted.changes;
    }
    if (backup.version >= 6) for (const image of backup.images) {
      const parent = await txn.getFirstAsync<{ id: string }>('SELECT id FROM entries WHERE id = ?', image.entryId);
      if (!parent || !image.localUri) continue;
      await txn.runAsync(
        `INSERT INTO entry_images (id, entry_id, uri, width, height, sort_order, created_at, media_type, paired_video_uri, duration, thumbnail_uri) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET uri = excluded.uri, width = excluded.width, height = excluded.height, sort_order = excluded.sort_order, media_type = excluded.media_type, paired_video_uri = excluded.paired_video_uri, duration = excluded.duration, thumbnail_uri = excluded.thumbnail_uri`,
        image.id, image.entryId, image.localUri, image.width, image.height, image.sortOrder, image.createdAt, image.mediaType ?? 'image', image.pairedVideoLocalUri ?? null, image.duration ?? null, image.thumbnailLocalUri ?? null,
      );
    }
    if (backup.version >= 7) for (const image of backup.followUpImages ?? []) {
      const parent = await txn.getFirstAsync<{ id: string }>('SELECT id FROM follow_ups WHERE id = ?', image.followUpId);
      if (!parent || !image.localUri) continue;
      await txn.runAsync(
        `INSERT INTO follow_up_images (id, follow_up_id, uri, width, height, sort_order, created_at, media_type, paired_video_uri, duration, thumbnail_uri) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET uri = excluded.uri, width = excluded.width, height = excluded.height, sort_order = excluded.sort_order, media_type = excluded.media_type, paired_video_uri = excluded.paired_video_uri, duration = excluded.duration, thumbnail_uri = excluded.thumbnail_uri`,
        image.id, image.followUpId, image.localUri, image.width, image.height, image.sortOrder, image.createdAt, image.mediaType ?? 'image', image.pairedVideoLocalUri ?? null, image.duration ?? null, image.thumbnailLocalUri ?? null,
      );
    }
    for (const version of backup.versions ?? []) {
      const parent = await txn.getFirstAsync<{ id: string }>('SELECT id FROM entries WHERE id = ?', version.entryId);
      if (!parent) continue;
      await txn.runAsync(
        `INSERT OR IGNORE INTO entry_versions (id, entry_id, content, occurred_at, mood, weather, location_name, latitude, longitude, tags_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        version.id, version.entryId, version.content, version.occurredAt, version.mood, version.weather,
        version.locationName, version.latitude, version.longitude, JSON.stringify(version.tags), version.createdAt,
      );
    }
    for (const entryId of backup.suppressedMemoryEntryIds ?? []) {
      const parent = await txn.getFirstAsync<{ id: string }>('SELECT id FROM entries WHERE id = ?', entryId);
      if (parent) await txn.runAsync(
        'INSERT OR IGNORE INTO memory_suppressed_entries (entry_id, suppressed_at) VALUES (?, ?)', entryId, new Date().toISOString(),
      );
    }
  });
  return result;
}

export async function createFollowUp(db: SQLiteDatabase, entryId: string, content: string) {
  const id = createId(); const now = new Date().toISOString();
  await db.runAsync(
    'INSERT INTO follow_ups (id, entry_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    id, entryId, content.trim(), now, now,
  );
  return id;
}

export async function createFollowUpWithImages(
  db: SQLiteDatabase,
  entryId: string,
  content: string,
  images: EntryAssetInput[],
) {
  const id = createId(); const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      'INSERT INTO follow_ups (id, entry_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      id, entryId, content.trim(), now, now,
    );
    for (const [index, image] of images.entries()) await txn.runAsync(
      'INSERT INTO follow_up_images (id, follow_up_id, uri, width, height, sort_order, created_at, media_type, paired_video_uri, duration, thumbnail_uri) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      createId(), id, image.uri, image.width, image.height, index, now, image.mediaType ?? 'image', image.pairedVideoUri ?? null, image.duration ?? null, image.thumbnailUri ?? null,
    );
  });
  return id;
}

export async function updateFollowUp(db: SQLiteDatabase, id: string, content: string) {
  await db.runAsync(
    'UPDATE follow_ups SET content = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
    content.trim(), new Date().toISOString(), id,
  );
}

export async function deleteFollowUp(db: SQLiteDatabase, id: string) {
  const images = await db.getAllAsync<{ uri: string }>(
    `SELECT uri FROM follow_up_images WHERE follow_up_id = ?
     UNION ALL SELECT paired_video_uri AS uri FROM follow_up_images WHERE follow_up_id = ? AND paired_video_uri IS NOT NULL
     UNION ALL SELECT thumbnail_uri AS uri FROM follow_up_images WHERE follow_up_id = ? AND thumbnail_uri IS NOT NULL`,
    id, id, id,
  );
  const now = new Date().toISOString();
  await db.runAsync('UPDATE follow_ups SET deleted_at = ?, updated_at = ? WHERE id = ?', now, now, id);
  return images.map((image) => image.uri);
}

export async function replaceEntryImages(
  db: SQLiteDatabase,
  entryId: string,
  images: EntryAssetInput[],
) {
  const existing = await db.getAllAsync<{ uri: string }>(
    `SELECT uri FROM entry_images WHERE entry_id = ?
     UNION ALL SELECT paired_video_uri AS uri FROM entry_images WHERE entry_id = ? AND paired_video_uri IS NOT NULL
     UNION ALL SELECT thumbnail_uri AS uri FROM entry_images WHERE entry_id = ? AND thumbnail_uri IS NOT NULL`,
    entryId, entryId, entryId,
  );
  const keptUris = new Set(images.flatMap((image) => [image.uri, image.pairedVideoUri, image.thumbnailUri].filter((uri): uri is string => Boolean(uri))));
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('DELETE FROM entry_images WHERE entry_id = ?', entryId);
    const now = new Date().toISOString();
    for (const [index, image] of images.entries()) {
      await txn.runAsync(
        'INSERT INTO entry_images (id, entry_id, uri, width, height, sort_order, created_at, media_type, paired_video_uri, duration, thumbnail_uri) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        createId(), entryId, image.uri, image.width, image.height, index, now, image.mediaType ?? 'image', image.pairedVideoUri ?? null, image.duration ?? null, image.thumbnailUri ?? null,
      );
    }
  });
  return existing.filter((image) => !keptUris.has(image.uri)).map((image) => image.uri);
}

export async function replaceEntryTags(db: SQLiteDatabase, entryId: string, tags: string[]) {
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('DELETE FROM entry_tags WHERE entry_id = ?', entryId);
    for (const [index, label] of tags.entries()) {
      await txn.runAsync(
        'INSERT INTO entry_tags (entry_id, label, sort_order) VALUES (?, ?, ?)',
        entryId, label, index,
      );
    }
  });
}

type DraftRow = { id: string; content: string; occurred_at: string; mood: string | null; weather: string | null; tags_json: string; images_json: string; location_name: string | null; latitude: number | null; longitude: number | null; created_at: string; updated_at: string };

function parseJsonArray<T>(value: string): T[] {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed as T[] : []; }
  catch { return []; }
}

function mapDraft(row: DraftRow): Draft {
  return { id: row.id, content: row.content, occurredAt: row.occurred_at, mood: row.mood, weather: row.weather,
    tags: parseJsonArray<string>(row.tags_json), images: parseJsonArray<DraftImage>(row.images_json),
    locationName: row.location_name, latitude: row.latitude, longitude: row.longitude, createdAt: row.created_at, updatedAt: row.updated_at };
}

async function migrateLegacyDraft(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM kv_store WHERE key = 'entry-draft'");
  if (!row) return;
  try {
    const legacy = JSON.parse(row.value) as { content?: string; occurredAt?: string; updatedAt?: string; tags?: string[]; mood?: string | null };
    if (!legacy.content?.trim()) return;
    const id = createId(); const now = legacy.updatedAt ?? new Date().toISOString();
    await db.runAsync(
      'INSERT INTO drafts (id, content, occurred_at, mood, weather, tags_json, images_json, location_name, latitude, longitude, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, legacy.content, legacy.occurredAt ?? now, legacy.mood ?? null, null, JSON.stringify(legacy.tags ?? []), '[]', null, null, null, now, now,
    );
  } catch { /* Ignore an unreadable legacy draft. */ }
  finally { await db.runAsync("DELETE FROM kv_store WHERE key = 'entry-draft'"); }
}

export function createDraftId() { return createId(); }

export async function listDrafts(db: SQLiteDatabase): Promise<Draft[]> {
  await migrateLegacyDraft(db);
  const rows = await db.getAllAsync<DraftRow>('SELECT id, content, occurred_at, mood, weather, tags_json, images_json, location_name, latitude, longitude, created_at, updated_at FROM drafts ORDER BY updated_at DESC');
  return rows.map(mapDraft);
}

export async function getDraft(db: SQLiteDatabase, id: string): Promise<Draft | null> {
  await migrateLegacyDraft(db);
  const row = await db.getFirstAsync<DraftRow>('SELECT id, content, occurred_at, mood, weather, tags_json, images_json, location_name, latitude, longitude, created_at, updated_at FROM drafts WHERE id = ?', id);
  return row ? mapDraft(row) : null;
}

export async function saveDraft(db: SQLiteDatabase, draft: Omit<Draft, 'createdAt'>) {
  await db.runAsync(
    `INSERT INTO drafts (id, content, occurred_at, mood, weather, tags_json, images_json, location_name, latitude, longitude, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET content = excluded.content, occurred_at = excluded.occurred_at,
       mood = excluded.mood, weather = excluded.weather, tags_json = excluded.tags_json, images_json = excluded.images_json,
       location_name = excluded.location_name, latitude = excluded.latitude, longitude = excluded.longitude, updated_at = excluded.updated_at`,
    draft.id, draft.content, draft.occurredAt, draft.mood, draft.weather, JSON.stringify(draft.tags), JSON.stringify(draft.images), draft.locationName?.trim() || null, draft.latitude, draft.longitude, draft.updatedAt, draft.updatedAt,
  );
}

export async function deleteDraft(db: SQLiteDatabase, id: string, keepImages = false) {
  const draft = await getDraft(db, id);
  await db.runAsync('DELETE FROM drafts WHERE id = ?', id);
  return keepImages ? [] : draft?.images.flatMap((image) => [image.uri, image.pairedVideoUri, image.thumbnailUri].filter((uri): uri is string => Boolean(uri))) ?? [];
}

export async function listReferencedMediaUris(db: SQLiteDatabase): Promise<string[]> {
  const referenced = new Set<string>();
  const rows = await db.getAllAsync<{ uri: string | null }>(
    `SELECT uri FROM entry_images
     UNION SELECT paired_video_uri AS uri FROM entry_images
     UNION SELECT thumbnail_uri AS uri FROM entry_images
     UNION SELECT uri FROM follow_up_images
     UNION SELECT paired_video_uri AS uri FROM follow_up_images
     UNION SELECT thumbnail_uri AS uri FROM follow_up_images`,
  );
  rows.forEach(({ uri }) => { if (uri) referenced.add(uri); });

  const drafts = await db.getAllAsync<{ images_json: string }>('SELECT images_json FROM drafts');
  drafts.forEach(({ images_json }) => {
    parseJsonArray<DraftImage>(images_json).forEach((image) => {
      [image.uri, image.pairedVideoUri, image.thumbnailUri].forEach((uri) => {
        if (uri) referenced.add(uri);
      });
    });
  });

  const preferences = await db.getFirstAsync<{ value: string }>("SELECT value FROM kv_store WHERE key = 'app-preferences'");
  if (preferences) {
    try {
      const avatarUri = (JSON.parse(preferences.value) as { avatarUri?: unknown }).avatarUri;
      if (typeof avatarUri === 'string') referenced.add(avatarUri);
    } catch {
      // Invalid preferences are ignored here and repaired by the preferences provider.
    }
  }
  return [...referenced];
}
