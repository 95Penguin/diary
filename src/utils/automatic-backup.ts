import type { SQLiteDatabase } from 'expo-sqlite';

import { createJournalExport, saveLastExportAt } from '@/database/journal-repository';
import { saveBackupToDirectory } from '@/utils/backup-directory';
import { createZipBackup, inspectZipBackup } from '@/utils/backup-zip';

export const AUTOMATIC_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const AUTOMATIC_BACKUP_RETENTION = 5;

export async function runAutomaticBackup(db: SQLiteDatabase, directoryUri: string) {
  const source = await createJournalExport(db);
  const archive = await createZipBackup(source);
  const inspected = inspectZipBackup(archive.bytes);
  if (inspected.entries.length !== source.entries.length || inspected.followUps.length !== source.followUps.length) {
    throw new Error('backup-verification-failed');
  }
  const now = new Date().toISOString();
  const stamp = now.replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const saved = await saveBackupToDirectory(
    directoryUri,
    archive.bytes,
    `拾时自动备份-${stamp}`,
    AUTOMATIC_BACKUP_RETENTION,
  );
  await saveLastExportAt(db, now);
  return { now, missingMedia: archive.missingMedia, retained: saved.retained };
}
