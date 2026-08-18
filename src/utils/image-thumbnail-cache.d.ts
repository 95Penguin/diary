import type { SQLiteDatabase } from 'expo-sqlite';
export function createPersistentImageThumbnail(uri: string): Promise<string | null>;
export function backfillImageThumbnails(db: SQLiteDatabase): Promise<void>;
export function clearImageThumbnailCache(db: SQLiteDatabase): Promise<number>;
