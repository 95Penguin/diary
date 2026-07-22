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
      return { ...image, dataBase64: await file.base64(), mimeType: file.type || null };
    } catch { return { ...image, dataBase64: null, mimeType: null }; }
  }));
  return { ...backup, images };
}

export async function materializeBackupImages(backup: JournalBackup) {
  const createdUris: string[] = [];
  const images = [] as JournalBackup['images'];
  try {
    for (const image of backup.images) {
      if (!image.dataBase64) { images.push({ ...image, localUri: '' }); continue; }
      const uri = await persistJournalImageBase64(image.dataBase64, extensionFor(image.mimeType, image.localUri));
      createdUris.push(uri); images.push({ ...image, localUri: uri });
    }
  } catch (error) {
    createdUris.forEach(deleteJournalImage);
    throw error;
  }
  return { backup: { ...backup, images }, createdUris };
}
