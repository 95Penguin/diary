export async function persistJournalImage(sourceUri: string) {
  return sourceUri;
}

export async function persistJournalImageBase64(dataBase64: string, extension = '.jpg') {
  const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${dataBase64}`;
}

export function deleteJournalImage(_uri: string) {
  // Browser object URLs are managed by the picker/browser lifecycle.
}
