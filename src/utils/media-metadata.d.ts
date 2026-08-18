export type MediaMetadata = { exists: boolean; bytes: number; format: string; createdAt: string | null };
export function inspectMediaFile(uri: string): Promise<MediaMetadata>;
