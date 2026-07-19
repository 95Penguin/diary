import type { SQLiteDatabase } from 'expo-sqlite';
import type { Draft, Entry, EntryImage, EntryInput, FollowUp } from '@/domain/journal';

type EntryRow = { id: string; content: string; occurred_at: string; created_at: string; updated_at: string };
type FollowUpRow = { id: string; entry_id: string; content: string; created_at: string; updated_at: string };
type ImageRow = { id: string; entry_id: string; uri: string; width: number; height: number; sort_order: number };

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
  return rows.map((row) => ({
    id: row.id, content: row.content, occurredAt: row.occurred_at, createdAt: row.created_at,
    updatedAt: row.updated_at, followUps: byEntry.get(row.id) ?? [], images: imagesByEntry.get(row.id) ?? [],
  }));
}

export async function listEntries(db: SQLiteDatabase, query = ''): Promise<Entry[]> {
  const keyword = query.trim();
  const params: string[] = [];
  let where = 'e.deleted_at IS NULL';
  if (keyword) {
    where += ` AND (e.content LIKE ? ESCAPE '\\' OR EXISTS (
      SELECT 1 FROM follow_ups f WHERE f.entry_id = e.id AND f.deleted_at IS NULL
      AND f.content LIKE ? ESCAPE '\\'))`;
    const escaped = keyword.replace(/[\\%_]/g, '\\$&');
    params.push(`%${escaped}%`, `%${escaped}%`);
  }
  const rows = await db.getAllAsync<EntryRow>(
    `SELECT e.id, e.content, e.occurred_at, e.created_at, e.updated_at FROM entries e
     WHERE ${where} ORDER BY e.occurred_at DESC, e.created_at DESC`, params,
  );
  return attachFollowUps(db, rows);
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
  const images = await db.getAllAsync<{ uri: string }>('SELECT uri FROM entry_images WHERE entry_id = ?', id);
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('UPDATE entries SET deleted_at = ?, updated_at = ? WHERE id = ?', now, now, id);
    await txn.runAsync('UPDATE follow_ups SET deleted_at = ?, updated_at = ? WHERE entry_id = ?', now, now, id);
    await txn.runAsync('DELETE FROM entry_images WHERE entry_id = ?', id);
  });
  return images.map((image) => image.uri);
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
