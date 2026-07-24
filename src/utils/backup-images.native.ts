import { File } from 'expo-file-system';

import type { JournalBackup } from '@/domain/journal';
import { deleteJournalImage, persistJournalImageBase64 } from '@/utils/image-storage';
import { createPersistentVideoThumbnail } from '@/utils/video-thumbnail-cache';

function extensionFor(mimeType: string | null | undefined, fallback: string) {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/heic' || mimeType === 'image/heif') return '.heic';
  return fallback.match(/\.[a-zA-Z0-9]+$/)?.[0] ?? '.jpg';
}

export type BackupMediaProgress = (completed: number, total: number) => void;

export async function embedBackupImages(backup: JournalBackup, onProgress?: BackupMediaProgress): Promise<JournalBackup> {
  const total = backup.images.length + (backup.followUpImages?.length ?? 0);
  let completed = 0;
  const images = [] as JournalBackup['images'];
  for (const image of backup.images) {
    try {
      const file = new File(image.localUri);
      if (!file.exists) { images.push({ ...image, dataBase64: null, mimeType: null }); continue; }
      const paired = image.pairedVideoLocalUri ? new File(image.pairedVideoLocalUri) : null;
      const thumbnail = image.thumbnailLocalUri ? new File(image.thumbnailLocalUri) : null;
      images.push({ ...image, dataBase64: await file.base64(), mimeType: file.type || null,
        pairedVideoDataBase64: paired?.exists ? await paired.base64() : null, pairedVideoMimeType: paired?.type || null,
        thumbnailDataBase64: thumbnail?.exists ? await thumbnail.base64() : null, thumbnailMimeType: thumbnail?.type || null });
    } catch { images.push({ ...image, dataBase64: null, mimeType: null }); }
    finally { completed += 1; onProgress?.(completed, total); }
  }
  const followUpImages = [] as NonNullable<JournalBackup['followUpImages']>;
  for (const image of backup.followUpImages ?? []) {
    try {
      const file = new File(image.localUri);
      if (!file.exists) { followUpImages.push({ ...image, dataBase64: null, mimeType: null }); continue; }
      const paired = image.pairedVideoLocalUri ? new File(image.pairedVideoLocalUri) : null;
      const thumbnail = image.thumbnailLocalUri ? new File(image.thumbnailLocalUri) : null;
      followUpImages.push({ ...image, dataBase64: await file.base64(), mimeType: file.type || null,
        pairedVideoDataBase64: paired?.exists ? await paired.base64() : null, pairedVideoMimeType: paired?.type || null,
        thumbnailDataBase64: thumbnail?.exists ? await thumbnail.base64() : null, thumbnailMimeType: thumbnail?.type || null });
    } catch { followUpImages.push({ ...image, dataBase64: null, mimeType: null }); }
    finally { completed += 1; onProgress?.(completed, total); }
  }
  return { ...backup, images, followUpImages };
}

export async function materializeBackupImages(backup: JournalBackup, onProgress?: BackupMediaProgress) {
  const createdUris: string[] = [];
  const images = [] as JournalBackup['images'];
  const followUpImages = [] as NonNullable<JournalBackup['followUpImages']>;
  const total = backup.images.length + (backup.followUpImages?.length ?? 0);
  let completed = 0;
  try {
    for (const image of backup.images) {
      if (!image.dataBase64) { images.push({ ...image, localUri: '' }); completed += 1; onProgress?.(completed, total); continue; }
      const uri = await persistJournalImageBase64(image.dataBase64, extensionFor(image.mimeType, image.localUri));
      let pairedVideoLocalUri: string | null = null;
      if (image.pairedVideoDataBase64) {
        pairedVideoLocalUri = await persistJournalImageBase64(image.pairedVideoDataBase64, extensionFor(image.pairedVideoMimeType, image.pairedVideoLocalUri ?? '.mov'));
        createdUris.push(pairedVideoLocalUri);
      }
      let thumbnailLocalUri = image.thumbnailDataBase64
        ? await persistJournalImageBase64(image.thumbnailDataBase64, extensionFor(image.thumbnailMimeType, image.thumbnailLocalUri ?? '.jpg'))
        : null;
      if (!thumbnailLocalUri && (image.mediaType === 'video' || image.duration)) thumbnailLocalUri = await createPersistentVideoThumbnail(uri);
      if (thumbnailLocalUri) createdUris.push(thumbnailLocalUri);
      createdUris.push(uri); images.push({ ...image, localUri: uri, pairedVideoLocalUri, thumbnailLocalUri });
      completed += 1; onProgress?.(completed, total);
    }
    for (const image of backup.followUpImages ?? []) {
      if (!image.dataBase64) { followUpImages.push({ ...image, localUri: '' }); completed += 1; onProgress?.(completed, total); continue; }
      const uri = await persistJournalImageBase64(image.dataBase64, extensionFor(image.mimeType, image.localUri));
      let pairedVideoLocalUri: string | null = null;
      if (image.pairedVideoDataBase64) {
        pairedVideoLocalUri = await persistJournalImageBase64(image.pairedVideoDataBase64, extensionFor(image.pairedVideoMimeType, image.pairedVideoLocalUri ?? '.mov'));
        createdUris.push(pairedVideoLocalUri);
      }
      let thumbnailLocalUri = image.thumbnailDataBase64
        ? await persistJournalImageBase64(image.thumbnailDataBase64, extensionFor(image.thumbnailMimeType, image.thumbnailLocalUri ?? '.jpg'))
        : null;
      if (!thumbnailLocalUri && (image.mediaType === 'video' || image.duration)) thumbnailLocalUri = await createPersistentVideoThumbnail(uri);
      if (thumbnailLocalUri) createdUris.push(thumbnailLocalUri);
      createdUris.push(uri); followUpImages.push({ ...image, localUri: uri, pairedVideoLocalUri, thumbnailLocalUri });
      completed += 1; onProgress?.(completed, total);
    }
  } catch (error) {
    createdUris.forEach(deleteJournalImage);
    throw error;
  }
  return { backup: { ...backup, images, followUpImages }, createdUris };
}
