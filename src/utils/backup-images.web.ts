import type { JournalBackup } from '@/domain/journal';
import { persistJournalImageBase64 } from '@/utils/image-storage';

function blobBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(blob);
  });
}

async function embedUri(uri: string | null | undefined) {
  if (!uri) return { dataBase64: null, mimeType: null };
  try {
    const response = await fetch(uri); const blob = await response.blob();
    return { dataBase64: await blobBase64(blob), mimeType: blob.type || null };
  } catch { return { dataBase64: null, mimeType: null }; }
}

export type BackupMediaProgress = (completed: number, total: number) => void;

export async function embedBackupImages(backup: JournalBackup, onProgress?: BackupMediaProgress): Promise<JournalBackup> {
  const total = backup.images.length + (backup.followUpImages?.length ?? 0);
  let completed = 0;
  const images = await Promise.all(backup.images.map(async (image) => {
    const primary = await embedUri(image.localUri);
    const paired = await embedUri(image.pairedVideoLocalUri);
    const thumbnail = await embedUri(image.thumbnailLocalUri);
    completed += 1; onProgress?.(completed, total);
    return { ...image, ...primary, pairedVideoDataBase64: paired.dataBase64, pairedVideoMimeType: paired.mimeType, thumbnailDataBase64: thumbnail.dataBase64, thumbnailMimeType: thumbnail.mimeType };
  }));
  const followUpImages = await Promise.all((backup.followUpImages ?? []).map(async (image) => {
    const primary = await embedUri(image.localUri);
    const paired = await embedUri(image.pairedVideoLocalUri);
    const thumbnail = await embedUri(image.thumbnailLocalUri);
    completed += 1; onProgress?.(completed, total);
    return { ...image, ...primary, pairedVideoDataBase64: paired.dataBase64, pairedVideoMimeType: paired.mimeType, thumbnailDataBase64: thumbnail.dataBase64, thumbnailMimeType: thumbnail.mimeType };
  }));
  return { ...backup, images, followUpImages };
}

export async function materializeBackupImages(backup: JournalBackup, onProgress?: BackupMediaProgress) {
  const total = backup.images.length + (backup.followUpImages?.length ?? 0);
  let completed = 0;
  const images = [] as JournalBackup['images'];
  for (const image of backup.images) {
    if (!image.dataBase64) { images.push({ ...image, localUri: '' }); completed += 1; onProgress?.(completed, total); continue; }
    const extension = image.mimeType === 'image/png' ? '.png' : image.mimeType === 'image/webp' ? '.webp' : '.jpg';
    const pairedVideoLocalUri = image.pairedVideoDataBase64 ? await persistJournalImageBase64(image.pairedVideoDataBase64, '.mov') : null;
    const thumbnailLocalUri = image.thumbnailDataBase64 ? await persistJournalImageBase64(image.thumbnailDataBase64, '.jpg') : null;
    images.push({ ...image, localUri: await persistJournalImageBase64(image.dataBase64, extension), pairedVideoLocalUri, thumbnailLocalUri });
    completed += 1; onProgress?.(completed, total);
  }
  const followUpImages = [] as NonNullable<JournalBackup['followUpImages']>;
  for (const image of backup.followUpImages ?? []) {
    if (!image.dataBase64) { followUpImages.push({ ...image, localUri: '' }); completed += 1; onProgress?.(completed, total); continue; }
    const extension = image.mimeType === 'image/png' ? '.png' : image.mimeType === 'image/webp' ? '.webp' : '.jpg';
    const pairedVideoLocalUri = image.pairedVideoDataBase64 ? await persistJournalImageBase64(image.pairedVideoDataBase64, '.mov') : null;
    const thumbnailLocalUri = image.thumbnailDataBase64 ? await persistJournalImageBase64(image.thumbnailDataBase64, '.jpg') : null;
    followUpImages.push({ ...image, localUri: await persistJournalImageBase64(image.dataBase64, extension), pairedVideoLocalUri, thumbnailLocalUri });
    completed += 1; onProgress?.(completed, total);
  }
  return { backup: { ...backup, images, followUpImages }, createdUris: [] as string[] };
}
