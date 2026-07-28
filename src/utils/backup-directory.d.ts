export type BackupDirectoryPermission = { granted: boolean; directoryUri?: string };
export type SavedDirectoryBackup = { uri: string; size: number; retained: number };

export function chooseBackupDirectory(initialUri?: string | null): Promise<BackupDirectoryPermission>;
export function saveBackupToDirectory(
  directoryUri: string,
  bytes: Uint8Array,
  filenameBase: string,
  maxBackups?: number,
): Promise<SavedDirectoryBackup>;
