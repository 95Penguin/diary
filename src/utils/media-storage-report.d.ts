import type { SQLiteDatabase } from 'expo-sqlite';
export function getMediaStorageReport(db: SQLiteDatabase): Promise<{ imageBytes: number; videoBytes: number; thumbnailBytes: number; totalBytes: number; mediaCount: number; missing: number }>;
