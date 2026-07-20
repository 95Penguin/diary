import type { SQLiteDatabase } from 'expo-sqlite';
import type { DeletedEntry, Draft, Entry, EntryImage, EntryInput, FollowUp, ImportResult, JournalBackup, JournalStats, SearchResult } from '@/domain/journal';

type EntryRow = { id: string; content: string; occurred_at: string; created_at: string; updated_at: string };
type FollowUpRow = { id: string; entry_id: string; content: string; created_at: string; updated_at: string };
type ImageRow = { id: string; entry_id: string; uri: string; width: number; height: number; sort_order: number };
type TagRow = { entry_id: string; label: string };
type DeletedEntryRow = EntryRow & { deleted_at: string };

function createId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
function mapFollowUp(row: FollowUpRow): FollowUp {
  return { id: row.id, entryId: row.entry_id, content: row.content, createdAt: row.created_at, updatedAt: row.updated_at };
}

async function attachFollowUps(db: SQLiteDatabase, rows: EntryRow[]): Promise<Entry[]> {
  if (!rows.length) return [];
  const placeholders = rows.map(() => '?').join(', ');
  const followUpRows = await db.getAllAsync<FollowUpRow>(
    `SELECT id, entry_id, content, created_at, updated_at FROM follow_ups
     WHERE deleted_at IS NULL AND entry_id IN (${placeholders}) ORDER BY created_at ASC`,
    rows.map((row) => row.id),
  );
  const byEntry = new Map<string, FollowUp[]>();
  for (const row of followUpRows) {
    const items = byEntry.get(row.entry_id) ?? [];
    items.push(mapFollowUp(row));
    byEntry.set(row.entry_id, items);
  }
  const imageRows = await db.getAllAsync<ImageRow>(
    `SELECT id, entry_id, uri, width, height, sort_order FROM entry_images
     WHERE entry_id IN (${placeholders}) ORDER BY sort_order ASC`,
    rows.map((row) => row.id),
  );
  const imagesByEntry = new Map<string, EntryImage[]>();
  for (const row of imageRows) {
    const items = imagesByEntry.get(row.entry_id) ?? [];
    items.push({ id: row.id, entryId: row.entry_id, uri: row.uri, width: row.width, height: row.height, sortOrder: row.sort_order });
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
    updatedAt: row.updated_at, followUps: byEntry.get(row.id) ?? [], images: imagesByEntry.get(row.id) ?? [], tags: tagsByEntry.get(row.id) ?? [],
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
    `SELECT e.id, e.content, e.occurred_at, e.created_at, e.updated_at FROM entries e
     WHERE ${where} ORDER BY e.occurred_at DESC, e.created_at DESC`, params,
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
    `SELECT e.id, e.content, e.occurred_at, e.created_at, e.updated_at FROM entries e
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
    'SELECT id, content, occurred_at, created_at, updated_at FROM entries WHERE id = ? AND deleted_at IS NULL', id,
  );
  if (!row) return null;
  return (await attachFollowUps(db, [row]))[0];
}

export async function createEntry(db: SQLiteDatabase, input: EntryInput): Promise<string> {
  const id = createId(); const now = new Date().toISOString();
  await db.runAsync(
    'INSERT INTO entries (id, content, occurred_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    id, input.content.trim(), input.occurredAt, now, now,
  );
  return id;
}

export async function updateEntry(db: SQLiteDatabase, id: string, input: EntryInput) {
  await db.runAsync(
    'UPDATE entries SET content = ?, occurred_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
    input.content.trim(), input.occurredAt, new Date().toISOString(), id,
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
    `SELECT id, content, occurred_at, created_at, updated_at, deleted_at FROM entries
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
  const images = await db.getAllAsync<{ uri: string }>('SELECT uri FROM entry_images WHERE entry_id = ?', id);
  await db.runAsync('DELETE FROM entries WHERE id = ? AND deleted_at IS NOT NULL', id);
  return images.map((image) => image.uri);
}

export async function cleanupExpiredTrash(db: SQLiteDatabase, retentionDays = 30) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const images = await db.getAllAsync<{ uri: string }>(
    `SELECT i.uri FROM entry_images i JOIN entries e ON e.id = i.entry_id
     WHERE e.deleted_at IS NOT NULL AND e.deleted_at < ?`, cutoff,
  );
  await db.runAsync('DELETE FROM entries WHERE deleted_at IS NOT NULL AND deleted_at < ?', cutoff);
  return images.map((image) => image.uri);
}

export async function getJournalStats(db: SQLiteDatabase): Promise<JournalStats> {
  const row = await db.getFirstAsync<JournalStats>(`
    SELECT
      (SELECT COUNT(*) FROM entries WHERE deleted_at IS NULL) AS entries,
      (SELECT COUNT(*) FROM follow_ups WHERE deleted_at IS NULL) AS followUps,
      (SELECT COUNT(*) FROM entry_images i JOIN entries e ON e.id = i.entry_id WHERE e.deleted_at IS NULL) AS images,
      (SELECT COUNT(*) FROM entries WHERE deleted_at IS NOT NULL) AS deleted
  `);
  return row ?? { entries: 0, followUps: 0, images: 0, deleted: 0 };
}

export async function createJournalExport(db: SQLiteDatabase) {
  const entries = await db.getAllAsync<{
    id: string; content: string; occurred_at: string; created_at: string; updated_at: string; deleted_at: string | null;
  }>('SELECT id, content, occurred_at, created_at, updated_at, deleted_at FROM entries ORDER BY occurred_at ASC');
  const followUps = await db.getAllAsync<{
    id: string; entry_id: string; content: string; created_at: string; updated_at: string; deleted_at: string | null;
  }>('SELECT id, entry_id, content, created_at, updated_at, deleted_at FROM follow_ups ORDER BY created_at ASC');
  const images = await db.getAllAsync<{
    id: string; entry_id: string; uri: string; width: number; height: number; sort_order: number; created_at: string;
  }>('SELECT id, entry_id, uri, width, height, sort_order, created_at FROM entry_images ORDER BY entry_id, sort_order ASC');
  const tags = await db.getAllAsync<{ entry_id: string; label: string; sort_order: number }>(
    'SELECT entry_id, label, sort_order FROM entry_tags ORDER BY entry_id, sort_order ASC',
  );
  return {
    format: 'shishi-journal',
    version: 1,
    exportedAt: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    entries: entries.map((entry) => ({
      id: entry.id, content: entry.content, occurredAt: entry.occurred_at, createdAt: entry.created_at,
      updatedAt: entry.updated_at, deletedAt: entry.deleted_at,
    })),
    followUps: followUps.map((item) => ({
      id: item.id, entryId: item.entry_id, content: item.content, createdAt: item.created_at,
      updatedAt: item.updated_at, deletedAt: item.deleted_at,
    })),
    images: images.map((image) => ({
      id: image.id, entryId: image.entry_id, localUri: image.uri, width: image.width, height: image.height,
      sortOrder: image.sort_order, createdAt: image.created_at,
    })),
    tags: tags.map((tag) => ({ entryId: tag.entry_id, label: tag.label, sortOrder: tag.sort_order })),
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

export async function importJournalBackup(db: SQLiteDatabase, backup: JournalBackup): Promise<ImportResult> {
  const result: ImportResult = { createdEntries: 0, updatedEntries: 0, createdFollowUps: 0, updatedFollowUps: 0, tags: 0 };
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const entry of backup.entries) {
      const existing = await txn.getFirstAsync<{ updated_at: string }>('SELECT updated_at FROM entries WHERE id = ?', entry.id);
      if (!existing) {
        await txn.runAsync(
          'INSERT INTO entries (id, content, occurred_at, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)',
          entry.id, entry.content, entry.occurredAt, entry.createdAt, entry.updatedAt, entry.deletedAt,
        );
        result.createdEntries += 1;
      } else if (entry.updatedAt > existing.updated_at) {
        await txn.runAsync(
          'UPDATE entries SET content = ?, occurred_at = ?, updated_at = ?, deleted_at = ? WHERE id = ?',
          entry.content, entry.occurredAt, entry.updatedAt, entry.deletedAt, entry.id,
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

export async function updateFollowUp(db: SQLiteDatabase, id: string, content: string) {
  await db.runAsync(
    'UPDATE follow_ups SET content = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
    content.trim(), new Date().toISOString(), id,
  );
}

export async function deleteFollowUp(db: SQLiteDatabase, id: string) {
  const now = new Date().toISOString();
  await db.runAsync('UPDATE follow_ups SET deleted_at = ?, updated_at = ? WHERE id = ?', now, now, id);
}

export async function replaceEntryImages(
  db: SQLiteDatabase,
  entryId: string,
  images: { uri: string; width: number; height: number }[],
) {
  const existing = await db.getAllAsync<{ uri: string }>('SELECT uri FROM entry_images WHERE entry_id = ?', entryId);
  const keptUris = new Set(images.map((image) => image.uri));
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('DELETE FROM entry_images WHERE entry_id = ?', entryId);
    const now = new Date().toISOString();
    for (const [index, image] of images.entries()) {
      await txn.runAsync(
        'INSERT INTO entry_images (id, entry_id, uri, width, height, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        createId(), entryId, image.uri, image.width, image.height, index, now,
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

export async function getDraft(db: SQLiteDatabase): Promise<Draft | null> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM kv_store WHERE key = 'entry-draft'");
  if (!row) return null;
  try { return JSON.parse(row.value) as Draft; } catch { return null; }
}

export async function saveDraft(db: SQLiteDatabase, draft: Draft) {
  await db.runAsync(
    `INSERT INTO kv_store (key, value) VALUES ('entry-draft', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`, JSON.stringify(draft),
  );
}

export async function clearDraft(db: SQLiteDatabase) {
  await db.runAsync("DELETE FROM kv_store WHERE key = 'entry-draft'");
}
