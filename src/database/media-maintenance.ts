import type { SQLiteDatabase } from 'expo-sqlite';

type DraftImage = { uri?: unknown };

export async function cleanupOrphanMediaMetadata(db: SQLiteDatabase) {
  const referenced = new Set<string>();
  const rows = await db.getAllAsync<{ uri: string | null }>(`
    SELECT uri FROM entry_images
    UNION SELECT uri FROM follow_up_images
    UNION SELECT uri FROM time_capsule_images
  `);
  rows.forEach(({ uri }) => { if (uri) referenced.add(uri); });
  const drafts = await db.getAllAsync<{ images_json: string }>('SELECT images_json FROM drafts');
  for (const draft of drafts) {
    try {
      const images = JSON.parse(draft.images_json) as DraftImage[];
      if (Array.isArray(images)) images.forEach((image) => { if (typeof image.uri === 'string') referenced.add(image.uri); });
    } catch { /* Invalid draft JSON is ignored by the draft reader too. */ }
  }
  const metadata = await db.getAllAsync<{ uri: string }>('SELECT uri FROM media_metadata');
  const orphaned = metadata.filter(({ uri }) => !referenced.has(uri)).map(({ uri }) => uri);
  if (!orphaned.length) return 0;
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const uri of orphaned) await txn.runAsync('DELETE FROM media_metadata WHERE uri = ?', uri);
  });
  return orphaned.length;
}

export async function deleteMediaMetadataForUris(db: SQLiteDatabase, uris: string[]) {
  const unique = [...new Set(uris)];
  if (!unique.length) return;
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const uri of unique) await txn.runAsync('DELETE FROM media_metadata WHERE uri = ?', uri);
  });
}

export async function removeMissingLibraryMediaReference(db: SQLiteDatabase, source: 'entry' | 'followUp', id: string) {
  const table = source === 'entry' ? 'entry_images' : 'follow_up_images';
  const row = await db.getFirstAsync<{ uri: string; paired_video_uri: string | null; thumbnail_uri: string | null }>(
    `SELECT uri, paired_video_uri, thumbnail_uri FROM ${table} WHERE id = ?`, id,
  );
  if (!row) return [];
  await db.runAsync(`DELETE FROM ${table} WHERE id = ?`, id);
  await cleanupOrphanMediaMetadata(db).catch(() => undefined);
  return [row.uri, row.paired_video_uri, row.thumbnail_uri].filter((uri): uri is string => Boolean(uri));
}

export async function updateLibraryMediaThumbnail(db: SQLiteDatabase, source: 'entry' | 'followUp', id: string, thumbnailUri: string | null) {
  const table = source === 'entry' ? 'entry_images' : 'follow_up_images';
  const result = await db.runAsync(`UPDATE ${table} SET thumbnail_uri = ? WHERE id = ?`, thumbnailUri, id);
  return result.changes > 0;
}
