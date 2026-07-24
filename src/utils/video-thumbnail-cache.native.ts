import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { SQLiteDatabase } from 'expo-sqlite';
import { createVideoPlayer, type VideoPlayer } from 'expo-video';

import { deleteJournalImage, persistJournalImage } from '@/utils/image-storage';

async function waitUntilReady(player: VideoPlayer) {
  if (player.status === 'readyToPlay') return true;
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      subscription.remove();
      resolve(ready);
    };
    const subscription = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') finish(true);
      else if (status === 'error') finish(false);
    });
    const timeout = setTimeout(() => finish(false), 10_000);
  });
}

export async function createPersistentVideoThumbnail(videoUri: string): Promise<string | null> {
  const player = createVideoPlayer(videoUri);
  try {
    if (!(await waitUntilReady(player))) return null;
    for (const time of [0, 0.1, 0.5]) {
      try {
        const [thumbnail] = await player.generateThumbnailsAsync(time, { maxWidth: 720, maxHeight: 720 });
        if (!thumbnail) continue;
        const context = ImageManipulator.manipulate(thumbnail);
        const rendered = await context.renderAsync();
        const cached = await rendered.saveAsync({ compress: 0.82, format: SaveFormat.JPEG });
        return await persistJournalImage(cached.uri, 'video-cover.jpg');
      } catch {
        // A few Android codecs cannot seek to the exact first frame.
      }
    }
    return null;
  } finally {
    player.release();
  }
}

type MissingThumbnail = { id: string; source: 'entry' | 'follow-up'; uri: string };

export async function backfillVideoThumbnails(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<MissingThumbnail>(
    `SELECT id, 'entry' AS source, uri FROM entry_images
       WHERE media_type = 'video' AND thumbnail_uri IS NULL
     UNION ALL
     SELECT id, 'follow-up' AS source, uri FROM follow_up_images
       WHERE media_type = 'video' AND thumbnail_uri IS NULL`,
  );
  for (const row of rows) {
    const thumbnailUri = await createPersistentVideoThumbnail(row.uri);
    if (!thumbnailUri) continue;
    try {
      const table = row.source === 'entry' ? 'entry_images' : 'follow_up_images';
      await db.runAsync(`UPDATE ${table} SET thumbnail_uri = ? WHERE id = ? AND thumbnail_uri IS NULL`, thumbnailUri, row.id);
    } catch {
      deleteJournalImage(thumbnailUri);
    }
  }
}
