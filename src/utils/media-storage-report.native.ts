import { File } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

type Row = { uri: string; media_type: string; thumbnail_uri: string | null; paired_video_uri: string | null };
function fileBytes(uri: string | null) {
  if (!uri) return 0;
  try { const file = new File(uri); return file.exists ? file.size ?? 0 : 0; } catch { return 0; }
}
export async function getMediaStorageReport(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<Row>(`
    SELECT uri, media_type, thumbnail_uri, paired_video_uri FROM entry_images
    UNION ALL SELECT uri, media_type, thumbnail_uri, paired_video_uri FROM follow_up_images
    UNION ALL SELECT uri, media_type, thumbnail_uri, paired_video_uri FROM time_capsule_images
  `);
  let imageBytes = 0; let videoBytes = 0; let thumbnailBytes = 0; let missing = 0;
  for (const row of rows) {
    const bytes = fileBytes(row.uri);
    if (!bytes) missing += 1;
    if (row.media_type === 'video') videoBytes += bytes; else imageBytes += bytes;
    videoBytes += fileBytes(row.paired_video_uri);
    thumbnailBytes += fileBytes(row.thumbnail_uri);
  }
  return { imageBytes, videoBytes, thumbnailBytes, totalBytes: imageBytes + videoBytes + thumbnailBytes, mediaCount: rows.length, missing };
}
