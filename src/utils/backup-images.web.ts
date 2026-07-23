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

export async function embedBackupImages(backup: JournalBackup): Promise<JournalBackup> {
  const images = await Promise.all(backup.images.map(async (image) => {
    const primary = await embedUri(image.localUri);
    const paired = await embedUri(image.pairedVideoLocalUri);
    return { ...image, ...primary, pairedVideoDataBase64: paired.dataBase64, pairedVideoMimeType: paired.mimeType };
  }));
  const followUpImages = await Promise.all((backup.followUpImages ?? []).map(async (image) => {
    const primary = await embedUri(image.localUri);
    const paired = await embedUri(image.pairedVideoLocalUri);
    return { ...image, ...primary, pairedVideoDataBase64: paired.dataBase64, pairedVideoMimeType: paired.mimeType };
  }));
  return { ...backup, images, followUpImages };
}

export async function materializeBackupImages(backup: JournalBackup) {
  const images = [] as JournalBackup['images'];
  for (const image of backup.images) {
    if (!image.dataBase64) { images.push({ ...image, localUri: '' }); continue; }
    const extension = image.mimeType === 'image/png' ? '.png' : image.mimeType === 'image/webp' ? '.webp' : '.jpg';
    const pairedVideoLocalUri = image.pairedVideoDataBase64 ? await persistJournalImageBase64(image.pairedVideoDataBase64, '.mov') : null;
    images.push({ ...image, localUri: await persistJournalImageBase64(image.dataBase64, extension), pairedVideoLocalUri });
  }
  const followUpImages = [] as NonNullable<JournalBackup['followUpImages']>;
  for (const image of backup.followUpImages ?? []) {
    if (!image.dataBase64) { followUpImages.push({ ...image, localUri: '' }); continue; }
    const extension = image.mimeType === 'image/png' ? '.png' : image.mimeType === 'image/webp' ? '.webp' : '.jpg';
    const pairedVideoLocalUri = image.pairedVideoDataBase64 ? await persistJournalImageBase64(image.pairedVideoDataBase64, '.mov') : null;
    followUpImages.push({ ...image, localUri: await persistJournalImageBase64(image.dataBase64, extension), pairedVideoLocalUri });
  }
  return { backup: { ...backup, images, followUpImages }, createdUris: [] as string[] };
}
