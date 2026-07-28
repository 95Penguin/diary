import type { BackupDirectoryPermission, SavedDirectoryBackup } from './backup-directory';

export async function chooseBackupDirectory(): Promise<BackupDirectoryPermission> {
  return { granted: false };
}

export async function saveBackupToDirectory(): Promise<SavedDirectoryBackup> {
  throw new Error('directory-backup-unavailable');
}
