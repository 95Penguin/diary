import { File, Paths } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import type { BackupDirectoryPermission, SavedDirectoryBackup } from './backup-directory';

const ZIP_MIME = 'application/zip';

export async function chooseBackupDirectory(initialUri?: string | null): Promise<BackupDirectoryPermission> {
  if (Platform.OS !== 'android') return { granted: false };
  const result = await LegacyFileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(initialUri);
  return result.granted ? { granted: true, directoryUri: result.directoryUri } : { granted: false };
}

export async function saveBackupToDirectory(
  directoryUri: string,
  bytes: Uint8Array,
  filenameBase: string,
  maxBackups = 5,
): Promise<SavedDirectoryBackup> {
  if (Platform.OS !== 'android') throw new Error('directory-backup-unavailable');

  const temporary = new File(Paths.cache, `${filenameBase}.zip`);
  if (temporary.exists) temporary.delete();
  temporary.create();
  temporary.write(bytes);

  try {
    const base64 = await LegacyFileSystem.readAsStringAsync(temporary.uri, {
      encoding: LegacyFileSystem.EncodingType.Base64,
    });
    const uri = await LegacyFileSystem.StorageAccessFramework.createFileAsync(directoryUri, filenameBase, ZIP_MIME);
    await LegacyFileSystem.StorageAccessFramework.writeAsStringAsync(uri, base64, {
      encoding: LegacyFileSystem.EncodingType.Base64,
    });
    const info = await LegacyFileSystem.getInfoAsync(uri);
    if (!info.exists || info.size !== bytes.byteLength) {
      await LegacyFileSystem.StorageAccessFramework.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
      throw new Error('directory-backup-verification-failed');
    }

    const files = await LegacyFileSystem.StorageAccessFramework.readDirectoryAsync(directoryUri);
    const backups = (await Promise.all(files.map(async (fileUri) => {
      const fileInfo = await LegacyFileSystem.getInfoAsync(fileUri);
      const decoded = decodeURIComponent(fileUri);
      const isShishiBackup = decoded.includes('拾时备份-') || decoded.includes('拾时自动备份-');
      return fileInfo.exists && !fileInfo.isDirectory && isShishiBackup && decoded.toLowerCase().includes('.zip')
        ? { uri: fileUri, modificationTime: fileInfo.modificationTime }
        : null;
    }))).filter((item): item is { uri: string; modificationTime: number } => Boolean(item))
      .sort((a, b) => b.modificationTime - a.modificationTime);

    await Promise.all(backups.slice(maxBackups).map((item) =>
      LegacyFileSystem.StorageAccessFramework.deleteAsync(item.uri, { idempotent: true }),
    ));
    return { uri, size: info.size, retained: Math.min(backups.length, maxBackups) };
  } finally {
    if (temporary.exists) temporary.delete();
  }
}
