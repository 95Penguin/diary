import type { JournalBackup } from '@/domain/journal';

export function embedBackupImages(backup: JournalBackup): Promise<JournalBackup>;
export function materializeBackupImages(backup: JournalBackup): Promise<{ backup: JournalBackup; createdUris: string[] }>;
