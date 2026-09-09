import type { JournalBackup } from '@/domain/journal';

export type ZipBackupProgress = (completed: number, total: number) => void;
export function createZipBackup(backup: JournalBackup, onProgress?: ZipBackupProgress): Promise<{ bytes: Uint8Array; missingMedia: number }>;
export function inspectZipBackup(bytes: Uint8Array): JournalBackup;
export function materializeZipBackup(bytes: Uint8Array, onProgress?: ZipBackupProgress): Promise<{ backup: JournalBackup; createdUris: string[] }>;
export function inspectZipBackupFile(uri: string): Promise<JournalBackup>;
export function materializeZipBackupFile(uri: string, onProgress?: ZipBackupProgress): Promise<{ backup: JournalBackup; createdUris: string[] }>;
