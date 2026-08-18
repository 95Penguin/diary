import type { SQLiteDatabase } from 'expo-sqlite';
export async function getMediaStorageReport(_db: SQLiteDatabase) { return { imageBytes: 0, videoBytes: 0, thumbnailBytes: 0, totalBytes: 0, mediaCount: 0, missing: 0 }; }
