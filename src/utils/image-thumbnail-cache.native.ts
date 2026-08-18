import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import { clearJournalThumbnailFiles, deleteJournalImage, persistJournalThumbnail } from '@/utils/image-storage';

export async function createPersistentImageThumbnail(uri: string) {
  try {
    const context = ImageManipulator.manipulate(uri);
    context.resize({ width: 720 });
    const rendered = await context.renderAsync();
    const cached = await rendered.saveAsync({ compress: 0.78, format: SaveFormat.JPEG });
    return await persistJournalThumbnail(cached.uri);
  } catch { return null; }
}

type MissingThumbnail = { id: string; source: 'entry' | 'follow-up' | 'capsule'; uri: string; thumbnail_uri: string | null };
export async function backfillImageThumbnails(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<MissingThumbnail>(`
    SELECT id, 'entry' AS source, uri, thumbnail_uri FROM entry_images WHERE media_type != 'video'
    UNION ALL SELECT id, 'follow-up' AS source, uri, thumbnail_uri FROM follow_up_images WHERE media_type != 'video'
    UNION ALL SELECT id, 'capsule' AS source, uri, thumbnail_uri FROM time_capsule_images WHERE media_type != 'video'
  `);
  let generated = 0;
  for (const row of rows) {
    try {
      if (row.thumbnail_uri && new File(row.thumbnail_uri).exists) continue;
      const thumbnail = await createPersistentImageThumbnail(row.uri);
      if (!thumbnail) continue;
      const table = row.source === 'entry' ? 'entry_images' : row.source === 'follow-up' ? 'follow_up_images' : 'time_capsule_images';
      const result = await db.runAsync(`UPDATE ${table} SET thumbnail_uri = ? WHERE id = ?`, thumbnail, row.id);
      if (!result.changes) deleteJournalImage(thumbnail);
      generated += 1;
      if (generated % 12 === 0) await new Promise((resolve) => setTimeout(resolve, 20));
    } catch { /* Missing or unsupported originals are reported by data health. */ }
  }
}

export async function clearImageThumbnailCache(db: SQLiteDatabase) {
  await db.execAsync(`UPDATE entry_images SET thumbnail_uri = NULL; UPDATE follow_up_images SET thumbnail_uri = NULL; UPDATE time_capsule_images SET thumbnail_uri = NULL;`);
  const usage = clearJournalThumbnailFiles();
  return usage.files;
}
