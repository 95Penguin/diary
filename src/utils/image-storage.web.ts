export async function persistJournalImage(sourceUri: string) {
  return sourceUri;
}

export async function persistJournalImageBase64(dataBase64: string, extension = '.jpg') {
  const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${dataBase64}`;
}

export async function persistJournalImageBytes(data: Uint8Array, extension = '.jpg') {
  let binary = '';
  for (let offset = 0; offset < data.length; offset += 0x8000) {
    binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000));
  }
  return persistJournalImageBase64(btoa(binary), extension);
}
export async function persistJournalThumbnail(sourceUri: string) { return sourceUri; }
export function getJournalStorageBreakdown() { return { original: { files: 0, bytes: 0 }, thumbnails: { files: 0, bytes: 0 }, totalBytes: 0 }; }
export function clearJournalThumbnailFiles() { return { files: 0, bytes: 0 }; }

export function deleteJournalImage(_uri: string) {
  // Browser object URLs are managed by the picker/browser lifecycle.
}

export async function getJournalMediaStorageUsage() {
  return { files: 0, bytes: 0 };
}

export async function cleanupUnusedJournalMedia(_referencedUris: string[]) {
  return { files: 0, bytes: 0, deletedFiles: 0, freedBytes: 0 };
}
