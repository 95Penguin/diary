import type { SQLiteDatabase } from 'expo-sqlite';
import type { JournalMediaType } from '@/domain/journal';

export type TimeCapsuleStatus = 'locked' | 'ready' | 'opened';
export type TimeCapsule = {
  id: string; title: string; content: string; openAt: string; openedAt: string | null;
  createdAt: string; updatedAt: string; status: TimeCapsuleStatus; notificationEnabled: boolean; replies: TimeCapsuleReply[]; images: TimeCapsuleImage[];
};
export type TimeCapsuleReply = { id: string; capsuleId: string; content: string; createdAt: string; updatedAt: string };
export type TimeCapsuleImage = { id: string; capsuleId: string; uri: string; width: number; height: number; sortOrder: number; mediaType: JournalMediaType; pairedVideoUri: string | null; duration: number | null; thumbnailUri: string | null };
export type DeletedTimeCapsule = TimeCapsule & { deletedAt: string };

type CapsuleRow = { id: string; title: string; content: string; open_at: string; opened_at: string | null; created_at: string; updated_at: string; notification_enabled: number };

function createId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }

export function getTimeCapsuleStatus(capsule: Pick<TimeCapsule, 'openAt' | 'openedAt'>, now = new Date()): TimeCapsuleStatus {
  if (capsule.openedAt) return 'opened';
  return new Date(capsule.openAt).getTime() <= now.getTime() ? 'ready' : 'locked';
}

function mapCapsule(row: CapsuleRow, now: Date, replies: TimeCapsuleReply[] = [], images: TimeCapsuleImage[] = []): TimeCapsule {
  const capsule = { id: row.id, title: row.title, content: row.content, openAt: row.open_at, openedAt: row.opened_at, createdAt: row.created_at, updatedAt: row.updated_at };
  const status = getTimeCapsuleStatus(capsule, now);
  return { ...capsule, content: status === 'opened' ? capsule.content : '', status, notificationEnabled: row.notification_enabled === 1, replies: status === 'opened' ? replies : [], images: status === 'opened' ? images : [] };
}

export async function listTimeCapsules(db: SQLiteDatabase, now = new Date()): Promise<TimeCapsule[]> {
  const rows = await db.getAllAsync<CapsuleRow>(`SELECT id, title, content, open_at, opened_at, created_at, updated_at, notification_enabled
    FROM time_capsules WHERE deleted_at IS NULL
    ORDER BY CASE WHEN opened_at IS NULL THEN 0 ELSE 1 END, open_at ASC, created_at DESC`);
  return rows.map((row) => mapCapsule(row, now));
}

export async function getTimeCapsule(db: SQLiteDatabase, id: string, now = new Date()): Promise<TimeCapsule | null> {
  const row = await db.getFirstAsync<CapsuleRow>(`SELECT id, title, content, open_at, opened_at, created_at, updated_at, notification_enabled
    FROM time_capsules WHERE id = ? AND deleted_at IS NULL`, id);
  if (!row) return null;
  const replies = row.opened_at ? await db.getAllAsync<{ id: string; capsule_id: string; content: string; created_at: string; updated_at: string }>('SELECT id, capsule_id, content, created_at, updated_at FROM time_capsule_replies WHERE capsule_id = ? ORDER BY created_at ASC', id) : [];
  const imageRows = row.opened_at ? await db.getAllAsync<{ id: string; capsule_id: string; uri: string; width: number; height: number; sort_order: number; media_type: JournalMediaType; paired_video_uri: string | null; duration: number | null; thumbnail_uri: string | null }>('SELECT id, capsule_id, uri, width, height, sort_order, media_type, paired_video_uri, duration, thumbnail_uri FROM time_capsule_images WHERE capsule_id = ? ORDER BY sort_order ASC', id) : [];
  return mapCapsule(row, now, replies.map((reply) => ({ id: reply.id, capsuleId: reply.capsule_id, content: reply.content, createdAt: reply.created_at, updatedAt: reply.updated_at })), imageRows.map((image) => ({ id: image.id, capsuleId: image.capsule_id, uri: image.uri, width: image.width, height: image.height, sortOrder: image.sort_order, mediaType: image.media_type, pairedVideoUri: image.paired_video_uri, duration: image.duration, thumbnailUri: image.thumbnail_uri })));
}

export async function createTimeCapsule(db: SQLiteDatabase, input: { title: string; content: string; openAt: string; notificationEnabled?: boolean }, now = new Date()): Promise<string> {
  const title = input.title.trim();
  const content = input.content.trim();
  const openAt = new Date(input.openAt);
  if (!title || !content) throw new Error('capsule-content-required');
  if (!Number.isFinite(openAt.getTime()) || openAt.getTime() <= now.getTime()) throw new Error('capsule-open-time-must-be-future');
  const id = createId();
  const createdAt = now.toISOString();
  await db.runAsync(`INSERT INTO time_capsules (id, title, content, open_at, created_at, updated_at, notification_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, id, title, content, openAt.toISOString(), createdAt, createdAt, input.notificationEnabled === false ? 0 : 1);
  return id;
}

export async function openTimeCapsule(db: SQLiteDatabase, id: string, now = new Date()): Promise<boolean> {
  const result = await db.runAsync(`UPDATE time_capsules SET opened_at = ?, updated_at = ?
    WHERE id = ? AND deleted_at IS NULL AND opened_at IS NULL AND open_at <= ?`, now.toISOString(), now.toISOString(), id, now.toISOString());
  return result.changes > 0;
}

export async function deleteTimeCapsule(db: SQLiteDatabase, id: string, now = new Date()) {
  await db.runAsync('UPDATE time_capsules SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', now.toISOString(), now.toISOString(), id);
}

export async function setTimeCapsuleNotification(db: SQLiteDatabase, id: string, enabled: boolean, now = new Date()) {
  await db.runAsync('UPDATE time_capsules SET notification_enabled = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', enabled ? 1 : 0, now.toISOString(), id);
}

export async function createTimeCapsuleReply(db: SQLiteDatabase, capsuleId: string, content: string, now = new Date()): Promise<string> {
  const value = content.trim();
  if (!value) throw new Error('capsule-reply-required');
  const capsule = await db.getFirstAsync<{ opened_at: string | null }>('SELECT opened_at FROM time_capsules WHERE id = ? AND deleted_at IS NULL', capsuleId);
  if (!capsule?.opened_at) throw new Error('capsule-not-opened');
  const id = createId();
  const createdAt = now.toISOString();
  await db.runAsync('INSERT INTO time_capsule_replies (id, capsule_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', id, capsuleId, value, createdAt, createdAt);
  return id;
}

export async function addTimeCapsuleImages(db: SQLiteDatabase, capsuleId: string, images: { uri: string; width: number; height: number; mediaType: JournalMediaType; pairedVideoUri?: string | null; duration?: number | null; thumbnailUri?: string | null }[], now = new Date()) {
  await db.withTransactionAsync(async () => {
    for (const [index, image] of images.entries()) await db.runAsync('INSERT INTO time_capsule_images (id, capsule_id, uri, width, height, sort_order, created_at, media_type, paired_video_uri, duration, thumbnail_uri) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', createId(), capsuleId, image.uri, image.width, image.height, index, now.toISOString(), image.mediaType, image.pairedVideoUri ?? null, image.duration ?? null, image.thumbnailUri ?? null);
  });
}

export async function listDeletedTimeCapsules(db: SQLiteDatabase, now = new Date()): Promise<DeletedTimeCapsule[]> {
  const rows = await db.getAllAsync<CapsuleRow & { deleted_at: string }>('SELECT id, title, content, open_at, opened_at, created_at, updated_at, deleted_at, notification_enabled FROM time_capsules WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC');
  return rows.map((row) => ({ ...mapCapsule({ ...row, opened_at: row.opened_at ?? now.toISOString() }, now), content: row.content, deletedAt: row.deleted_at }));
}

export async function restoreTimeCapsule(db: SQLiteDatabase, id: string, now = new Date()) {
  await db.runAsync('UPDATE time_capsules SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL', now.toISOString(), id);
}

export async function permanentlyDeleteTimeCapsule(db: SQLiteDatabase, id: string) {
  const rows = await db.getAllAsync<{ uri: string }>(`SELECT uri FROM time_capsule_images WHERE capsule_id = ? UNION ALL SELECT paired_video_uri AS uri FROM time_capsule_images WHERE capsule_id = ? AND paired_video_uri IS NOT NULL UNION ALL SELECT thumbnail_uri AS uri FROM time_capsule_images WHERE capsule_id = ? AND thumbnail_uri IS NOT NULL`, id, id, id);
  await db.runAsync('DELETE FROM time_capsules WHERE id = ? AND deleted_at IS NOT NULL', id);
  return rows.map((row) => row.uri);
}

export async function cleanupExpiredTimeCapsules(db: SQLiteDatabase, retentionDays = 30) {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const rows = await db.getAllAsync<{ uri: string }>(`SELECT i.uri FROM time_capsule_images i JOIN time_capsules c ON c.id = i.capsule_id WHERE c.deleted_at IS NOT NULL AND c.deleted_at < ?
    UNION ALL SELECT i.paired_video_uri AS uri FROM time_capsule_images i JOIN time_capsules c ON c.id = i.capsule_id WHERE c.deleted_at IS NOT NULL AND c.deleted_at < ? AND i.paired_video_uri IS NOT NULL
    UNION ALL SELECT i.thumbnail_uri AS uri FROM time_capsule_images i JOIN time_capsules c ON c.id = i.capsule_id WHERE c.deleted_at IS NOT NULL AND c.deleted_at < ? AND i.thumbnail_uri IS NOT NULL`, cutoff, cutoff, cutoff);
  await db.runAsync('DELETE FROM time_capsules WHERE deleted_at IS NOT NULL AND deleted_at < ?', cutoff);
  return rows.map((row) => row.uri);
}
