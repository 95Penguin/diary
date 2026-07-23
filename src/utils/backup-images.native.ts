import { File } from 'expo-file-system';

import type { JournalBackup } from '@/domain/journal';
import { deleteJournalImage, persistJournalImageBase64 } from '@/utils/image-storage';

function extensionFor(mimeType: string | null | undefined, fallback: string) {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/heic' || mimeType === 'image/heif') return '.heic';
  return fallback.match(/\.[a-zA-Z0-9]+$/)?.[0] ?? '.jpg';
}

export async function embedBackupImages(backup: JournalBackup): Promise<JournalBackup> {
  const images = await Promise.all(backup.images.map(async (image) => {
    try {
      const file = new File(image.localUri);
      if (!file.exists) return { ...image, dataBase64: null, mimeType: null };
      const paired = image.pairedVideoLocalUri ? new File(image.pairedVideoLocalUri) : null;
      return { ...image, dataBase64: await file.base64(), mimeType: file.type || null,
        pairedVideoDataBase64: paired?.exists ? await paired.base64() : null, pairedVideoMimeType: paired?.type || null };
    } catch { return { ...image, dataBase64: null, mimeType: null }; }
  }));
  const followUpImages = await Promise.all((backup.followUpImages ?? []).map(async (image) => {
    try {
      const file = new File(image.localUri);
      if (!file.exists) return { ...image, dataBase64: null, mimeType: null };
      const paired = image.pairedVideoLocalUri ? new File(image.pairedVideoLocalUri) : null;
      return { ...image, dataBase64: await file.base64(), mimeType: file.type || null,
        pairedVideoDataBase64: paired?.exists ? await paired.base64() : null, pairedVideoMimeType: paired?.type || null };
    } catch { return { ...image, dataBase64: null, mimeType: null }; }
  }));
  return { ...backup, images, followUpImages };
}

export async function materializeBackupImages(backup: JournalBackup) {
  const createdUris: string[] = [];
  const images = [] as JournalBackup['images'];
  const followUpImages = [] as NonNullable<JournalBackup['followUpImages']>;
  try {
    for (const image of backup.images) {
      if (!image.dataBase64) { images.push({ ...image, localUri: '' }); continue; }
      const uri = await persistJournalImageBase64(image.dataBase64, extensionFor(image.mimeType, image.localUri));
      let pairedVideoLocalUri: string | null = null;
      if (image.pairedVideoDataBase64) {
        pairedVideoLocalUri = await persistJournalImageBase64(image.pairedVideoDataBase64, extensionFor(image.pairedVideoMimeType, image.pairedVideoLocalUri ?? '.mov'));
        createdUris.push(pairedVideoLocalUri);
      }
      createdUris.push(uri); images.push({ ...image, localUri: uri, pairedVideoLocalUri });
    }
    for (const image of backup.followUpImages ?? []) {
      if (!image.dataBase64) { followUpImages.push({ ...image, localUri: '' }); continue; }
      const uri = await persistJournalImageBase64(image.dataBase64, extensionFor(image.mimeType, image.localUri));
      let pairedVideoLocalUri: string | null = null;
      if (image.pairedVideoDataBase64) {
        pairedVideoLocalUri = await persistJournalImageBase64(image.pairedVideoDataBase64, extensionFor(image.pairedVideoMimeType, image.pairedVideoLocalUri ?? '.mov'));
        createdUris.push(pairedVideoLocalUri);
      }
      createdUris.push(uri); followUpImages.push({ ...image, localUri: uri, pairedVideoLocalUri });
    }
  } catch (error) {
    createdUris.forEach(deleteJournalImage);
    throw error;
  }
  return { backup: { ...backup, images, followUpImages }, createdUris };
}
