import type { SQLiteDatabase } from 'expo-sqlite';

export function createPersistentVideoThumbnail(videoUri: string): Promise<string | null>;
export function backfillVideoThumbnails(db: SQLiteDatabase): Promise<void>;
