import { File } from 'expo-file-system';

export type MediaMetadata = { exists: boolean; bytes: number; format: string; createdAt: string | null };
export async function inspectMediaFile(uri: string): Promise<MediaMetadata> {
  try {
    const file = new File(uri);
    return { exists: file.exists, bytes: file.exists ? file.size ?? 0 : 0, format: file.extension.replace(/^\./, '').toUpperCase() || '未知', createdAt: file.modificationTime ? new Date(file.modificationTime).toISOString() : null };
  } catch { return { exists: false, bytes: 0, format: '未知', createdAt: null }; }
}
