import type { SQLiteDatabase } from 'expo-sqlite';

import { getJournalStats, getLastExportAt } from './journal-repository.ts';
import type { JournalStats } from '@/domain/journal';

export type DataHealthReport = {
  checkedAt: string;
  databaseOk: boolean;
  databaseMessage: string;
  foreignKeyIssues: number;
  invalidDates: number;
  referencedMediaFiles: number;
  missingMediaFiles: number;
  expiredTrashEntries: number;
  lastExportAt: string | null;
  stats: JournalStats;
};

export type DataHealthLevel = 'healthy' | 'attention' | 'critical';

export function dataHealthLevel(report: DataHealthReport, now = new Date()): DataHealthLevel {
  if (!report.databaseOk || report.foreignKeyIssues || report.missingMediaFiles) return 'critical';
  const backupAge = report.lastExportAt ? now.getTime() - new Date(report.lastExportAt).getTime() : Number.POSITIVE_INFINITY;
  if ((report.stats.entries > 0 && backupAge > 30 * 86_400_000) || report.invalidDates || report.expiredTrashEntries) return 'attention';
  return 'healthy';
}

export async function runDataHealthCheck(
  db: SQLiteDatabase,
  mediaExists: (uri: string) => boolean | Promise<boolean>,
): Promise<DataHealthReport> {
  const [quickRows, foreignRows, dateRow, expiredRow, mediaRows, lastExportAt, stats] = await Promise.all([
    db.getAllAsync<{ quick_check: string }>('PRAGMA quick_check'),
    db.getAllAsync<Record<string, unknown>>('PRAGMA foreign_key_check'),
    db.getFirstAsync<{ count: number }>(`SELECT COUNT(*) AS count FROM entries
      WHERE julianday(occurred_at) IS NULL OR julianday(created_at) IS NULL OR julianday(updated_at) IS NULL`),
    db.getFirstAsync<{ count: number }>(`SELECT
      (SELECT COUNT(*) FROM entries WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-30 days'))
      + (SELECT COUNT(*) FROM time_capsules WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-30 days')) AS count`),
    db.getAllAsync<{ uri: string | null }>(`
      SELECT uri FROM entry_images
      UNION ALL SELECT paired_video_uri AS uri FROM entry_images WHERE paired_video_uri IS NOT NULL
      UNION ALL SELECT thumbnail_uri AS uri FROM entry_images WHERE thumbnail_uri IS NOT NULL
      UNION ALL SELECT uri FROM follow_up_images
      UNION ALL SELECT paired_video_uri AS uri FROM follow_up_images WHERE paired_video_uri IS NOT NULL
      UNION ALL SELECT thumbnail_uri AS uri FROM follow_up_images WHERE thumbnail_uri IS NOT NULL
      UNION ALL SELECT uri FROM time_capsule_images
      UNION ALL SELECT paired_video_uri AS uri FROM time_capsule_images WHERE paired_video_uri IS NOT NULL
      UNION ALL SELECT thumbnail_uri AS uri FROM time_capsule_images WHERE thumbnail_uri IS NOT NULL
    `),
    getLastExportAt(db),
    getJournalStats(db),
  ]);
  const mediaUris = [...new Set(mediaRows.map((row) => row.uri?.trim()).filter((uri): uri is string => Boolean(uri)))];
  const existence = await Promise.all(mediaUris.map(async (uri) => {
    try { return await mediaExists(uri); } catch { return false; }
  }));
  const databaseMessages = quickRows.map((row) => row.quick_check);
  const databaseOk = databaseMessages.length === 1 && databaseMessages[0] === 'ok';
  return {
    checkedAt: new Date().toISOString(),
    databaseOk,
    databaseMessage: databaseOk ? '正常' : databaseMessages.join('；') || '检查失败',
    foreignKeyIssues: foreignRows.length,
    invalidDates: Number(dateRow?.count ?? 0),
    referencedMediaFiles: mediaUris.length,
    missingMediaFiles: existence.filter((exists) => !exists).length,
    expiredTrashEntries: Number(expiredRow?.count ?? 0),
    lastExportAt,
    stats,
  };
}
