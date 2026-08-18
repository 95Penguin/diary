import type { MediaMetadata } from './media-metadata.native';
export async function inspectMediaFile(uri: string): Promise<MediaMetadata> {
  const match = /^data:([^;,]+)/.exec(uri); return { exists: Boolean(uri), bytes: 0, format: match?.[1]?.split('/')[1]?.toUpperCase() ?? '未知', createdAt: null };
}
