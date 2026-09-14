import type { SQLiteDatabase } from 'expo-sqlite';
import { File } from 'expo-file-system';
import * as Network from 'expo-network';

import { createJournalExport, saveLastExportAt } from '@/database/journal-repository';
import type { AppPreferences } from '@/preferences/app-preferences';
import { createZipBackupFile, inspectZipBackupFile } from '@/utils/backup-zip';
import { getWebDavPassword } from '@/utils/webdav-credentials';
import { deleteWebDavBackup, listWebDavBackups, uploadWebDavBackup, type WebDavConfig } from '@/utils/webdav';
import { withBackupOperation } from '@/utils/backup-operation';

export type AutomaticWebDavResult = { status: 'uploaded'; now: string; missingMedia: number } | { status: 'skipped' };

export async function runAutomaticWebDavBackup(db: SQLiteDatabase, preferences: AppPreferences): Promise<AutomaticWebDavResult> {
  if (!preferences.automaticWebDavBackupEnabled || !preferences.webDavServerUrl || !preferences.webDavUsername) return { status: 'skipped' };
  const last = preferences.lastWebDavBackupAt ? Date.parse(preferences.lastWebDavBackupAt) : 0;
  if (Number.isFinite(last) && Date.now() - last < preferences.webDavBackupIntervalDays * 86_400_000) return { status: 'skipped' };
  const network = await Network.getNetworkStateAsync();
  if (!network.isConnected || network.isInternetReachable === false) return { status: 'skipped' };
  if (preferences.webDavWifiOnly && network.type !== Network.NetworkStateType.WIFI) return { status: 'skipped' };
  return withBackupOperation(async () => {
  const password = await getWebDavPassword();
  if (!password) throw new Error('webdav-credentials-required');
  const config: WebDavConfig = {
    serverUrl: preferences.webDavServerUrl,
    username: preferences.webDavUsername,
    password,
    directory: preferences.webDavDirectory,
  };
  const source = await createJournalExport(db);
  const archive = await createZipBackupFile(source);
  try {
    const inspected = await inspectZipBackupFile(archive.uri);
    if (inspected.entries.length !== source.entries.length || inspected.followUps.length !== source.followUps.length) throw new Error('backup-verification-failed');
    const now = new Date().toISOString();
    const stamp = `${now.replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}-${now.slice(20, 23)}`;
    await uploadWebDavBackup(config, archive.uri, `拾时云备份-${stamp}.zip`);
    await saveLastExportAt(db, now);
    if (preferences.webDavBackupRetention) {
      try {
        const files = await listWebDavBackups(config);
        for (const file of files.slice(preferences.webDavBackupRetention)) await deleteWebDavBackup(config, file.filename, file.segmented);
      } catch { /* Retention cleanup must not turn a successful upload into a retry. */ }
    }
    return { status: 'uploaded', now, missingMedia: archive.missingMedia };
  } finally {
    const file = new File(archive.uri);
    if (file.exists) file.delete();
  }
  });
}
