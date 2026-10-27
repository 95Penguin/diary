import type { SQLiteDatabase } from 'expo-sqlite';

import { localDateKey } from '../utils/entry-time-range.ts';

export type SleepRecord = { id: string; nightDate: string; occurredAt: string; createdAt: string; updatedAt: string };
type SleepRecordRow = { id: string; night_date: string; occurred_at: string; created_at: string; updated_at: string };

function mapRecord(row: SleepRecordRow): SleepRecord {
  return { id: row.id, nightDate: row.night_date, occurredAt: row.occurred_at, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function sleepNightDate(date: Date) {
  const night = new Date(date);
  if (night.getHours() < 12) night.setDate(night.getDate() - 1);
  return localDateKey(night);
}

function createId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }

export async function listSleepRecords(db: SQLiteDatabase, startDate?: string, endDate?: string) {
  const rows = startDate && endDate
    ? await db.getAllAsync<SleepRecordRow>('SELECT id, night_date, occurred_at, created_at, updated_at FROM sleep_records WHERE night_date >= ? AND night_date < ? ORDER BY night_date DESC', startDate, endDate)
    : await db.getAllAsync<SleepRecordRow>('SELECT id, night_date, occurred_at, created_at, updated_at FROM sleep_records ORDER BY night_date DESC');
  return rows.map(mapRecord);
}

export async function getLatestSleepRecords(db: SQLiteDatabase, limit = 7) {
  const rows = await db.getAllAsync<SleepRecordRow>('SELECT id, night_date, occurred_at, created_at, updated_at FROM sleep_records ORDER BY night_date DESC LIMIT ?', limit);
  return rows.map(mapRecord);
}

export async function getSleepRecordForNight(db: SQLiteDatabase, nightDate: string) {
  const row = await db.getFirstAsync<SleepRecordRow>('SELECT id, night_date, occurred_at, created_at, updated_at FROM sleep_records WHERE night_date = ?', nightDate);
  return row ? mapRecord(row) : null;
}

export async function getSleepRecordBounds(db: SQLiteDatabase) {
  return db.getFirstAsync<{ first_date: string | null; last_date: string | null }>('SELECT MIN(night_date) AS first_date, MAX(night_date) AS last_date FROM sleep_records');
}

export async function saveSleepRecord(db: SQLiteDatabase, occurredAt: string, id?: string) {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) throw new Error('invalid-sleep-time');
  const now = new Date().toISOString();
  const nightDate = sleepNightDate(date);
  const existing = id
    ? await db.getFirstAsync<{ id: string; created_at: string }>('SELECT id, created_at FROM sleep_records WHERE id = ?', id)
    : await getSleepRecordForNight(db, nightDate);
  if (id && !existing) throw new Error('sleep-record-not-found');
  const recordId = existing?.id ?? createId();
  if (existing) {
    await db.runAsync('UPDATE sleep_records SET night_date = ?, occurred_at = ?, updated_at = ? WHERE id = ?', nightDate, date.toISOString(), now, recordId);
  } else {
    await db.runAsync('INSERT INTO sleep_records (id, night_date, occurred_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', recordId, nightDate, date.toISOString(), now, now);
  }
  return getSleepRecordForNight(db, nightDate);
}

export async function deleteSleepRecord(db: SQLiteDatabase, id: string) {
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<{ id: string }>('SELECT id FROM sleep_records WHERE id = ?', id);
    if (!row) return;
    await db.runAsync('DELETE FROM sleep_records WHERE id = ?', id);
    await db.runAsync(
      `INSERT INTO sleep_record_deletions (id, deleted_at) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET deleted_at = excluded.deleted_at`,
      id, now,
    );
  });
}
