import type { JournalBackup } from '@/domain/journal';

export type BackupMediaProgress = (completed: number, total: number) => void;
export function embedBackupImages(backup: JournalBackup, onProgress?: BackupMediaProgress): Promise<JournalBackup>;
export function materializeBackupImages(backup: JournalBackup, onProgress?: BackupMediaProgress): Promise<{ backup: JournalBackup; createdUris: string[] }>;
