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

export async function embedBackupImages(backup: JournalBackup): Promise<JournalBackup> {
  const images = await Promise.all(backup.images.map(async (image) => {
    try {
      const response = await fetch(image.localUri); const blob = await response.blob();
      return { ...image, dataBase64: await blobBase64(blob), mimeType: blob.type || null };
    } catch { return { ...image, dataBase64: null, mimeType: null }; }
  }));
  return { ...backup, images };
}

export async function materializeBackupImages(backup: JournalBackup) {
  const images = [] as JournalBackup['images'];
  for (const image of backup.images) {
    if (!image.dataBase64) { images.push({ ...image, localUri: '' }); continue; }
    const extension = image.mimeType === 'image/png' ? '.png' : image.mimeType === 'image/webp' ? '.webp' : '.jpg';
    images.push({ ...image, localUri: await persistJournalImageBase64(image.dataBase64, extension) });
  }
  return { backup: { ...backup, images }, createdUris: [] as string[] };
}
