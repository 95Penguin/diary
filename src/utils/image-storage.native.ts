import { Directory, EncodingType, File, Paths } from 'expo-file-system';

const imageDirectory = new Directory(Paths.document, 'journal-images');

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

export function deleteJournalImage(uri: string) {
  if (!uri.startsWith(imageDirectory.uri)) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // A missing file is already in the desired state.
  }
}
