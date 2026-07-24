export function persistJournalImage(sourceUri: string, suggestedName?: string | null): Promise<string>;
export function persistJournalImageBase64(dataBase64: string, extension?: string): Promise<string>;
export function deleteJournalImage(uri: string): void;
export type JournalMediaStorageUsage = { files: number; bytes: number };
export type JournalMediaCleanupResult = JournalMediaStorageUsage & { deletedFiles: number; freedBytes: number };
export function getJournalMediaStorageUsage(): Promise<JournalMediaStorageUsage>;
export function cleanupUnusedJournalMedia(referencedUris: string[], gracePeriodMs?: number): Promise<JournalMediaCleanupResult>;
