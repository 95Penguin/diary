import { Directory, EncodingType, File, Paths } from 'expo-file-system';

import { shouldDeleteUnusedMedia } from '@/utils/media-cleanup-policy';

const imageDirectory = new Directory(Paths.document, 'journal-images');
const thumbnailDirectory = new Directory(Paths.cache, 'journal-thumbnails');
let lastCleanupAt = 0;

export async function persistJournalImage(sourceUri: string, suggestedName?: string | null) {
  imageDirectory.create({ idempotent: true, intermediates: true });
  const extension = suggestedName?.match(/\.[a-zA-Z0-9]+$/)?.[0] ?? (new File(sourceUri).extension || '.jpg');
  const destination = new File(imageDirectory, `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${extension}`);
  await new File(sourceUri).copy(destination);
  return destination.uri;
}

export async function persistJournalImageBase64(dataBase64: string, extension = '.jpg') {
  imageDirectory.create({ idempotent: true, intermediates: true });
  const safeExtension = /^\.[a-zA-Z0-9]+$/.test(extension) ? extension : '.jpg';
  const destination = new File(imageDirectory, `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${safeExtension}`);
  destination.create({ intermediates: true });
  destination.write(dataBase64, { encoding: EncodingType.Base64 });
  return destination.uri;
}

export async function persistJournalImageBytes(data: Uint8Array, extension = '.jpg') {
  imageDirectory.create({ idempotent: true, intermediates: true });
  const safeExtension = /^\.[a-zA-Z0-9]+$/.test(extension) ? extension : '.jpg';
  const destination = new File(imageDirectory, `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${safeExtension}`);
  destination.create({ intermediates: true });
  destination.write(data);
  return destination.uri;
}

export async function persistJournalThumbnail(sourceUri: string) {
  thumbnailDirectory.create({ idempotent: true, intermediates: true });
  const destination = new File(thumbnailDirectory, `${Date.now()}-${Math.random().toString(36).slice(2, 9)}.jpg`);
  await new File(sourceUri).copy(destination);
  return destination.uri;
}

export function deleteJournalImage(uri: string) {
  if (!uri.startsWith(imageDirectory.uri) && !uri.startsWith(thumbnailDirectory.uri)) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // A missing file is already in the desired state.
  }
}

function directoryUsage(directory: Directory) {
  if (!directory.exists) return { files: 0, bytes: 0 };
  let files = 0; let bytes = 0;
  for (const item of directory.list()) if (item instanceof File) { files += 1; bytes += item.size ?? 0; }
  return { files, bytes };
}

export function getJournalStorageBreakdown() {
  const original = directoryUsage(imageDirectory);
  const thumbnails = directoryUsage(thumbnailDirectory);
  return { original, thumbnails, totalBytes: original.bytes + thumbnails.bytes };
}

export function clearJournalThumbnailFiles() {
  const usage = directoryUsage(thumbnailDirectory);
  if (thumbnailDirectory.exists) thumbnailDirectory.delete();
  return usage;
}

export async function getJournalMediaStorageUsage() {
  if (!imageDirectory.exists) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  for (const item of imageDirectory.list()) {
    if (!(item instanceof File)) continue;
    files += 1;
    bytes += item.size ?? 0;
  }
  return { files, bytes };
}

export async function cleanupUnusedJournalMedia(referencedUris: string[], gracePeriodMs = 6 * 60 * 60 * 1000) {
  const now = Date.now();
  if (now - lastCleanupAt < 60 * 60 * 1000) {
    const usage = await getJournalMediaStorageUsage();
    return { ...usage, deletedFiles: 0, freedBytes: 0 };
  }
  lastCleanupAt = now;
  if (!imageDirectory.exists) return { files: 0, bytes: 0, deletedFiles: 0, freedBytes: 0 };

  const referenced = new Set(referencedUris);
  let files = 0;
  let bytes = 0;
  let deletedFiles = 0;
  let freedBytes = 0;
  for (const item of imageDirectory.list()) {
    if (!(item instanceof File)) continue;
    const size = item.size ?? 0;
    if (shouldDeleteUnusedMedia(
      { uri: item.uri, modificationTime: item.modificationTime },
      referenced,
      now,
      gracePeriodMs,
    )) {
      try {
        item.delete();
        deletedFiles += 1;
        freedBytes += size;
      } catch {
        files += 1;
        bytes += size;
      }
      continue;
    }
    files += 1;
    bytes += size;
  }
  return { files, bytes, deletedFiles, freedBytes };
}
