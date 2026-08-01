import type { Entry } from '@/domain/journal';

export const SHARE_CARD_CONTENT_LIMIT = 420;

export function shareCardText(content: string, limit = SHARE_CARD_CONTENT_LIMIT) {
  const normalized = content.trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit).trimEnd()}……`;
}

export function shareCardImageUri(entry: Pick<Entry, 'images'>) {
  const medium = entry.images.find((item) => item.mediaType !== 'video' || item.thumbnailUri);
  if (!medium) return null;
  return medium.mediaType === 'video' ? medium.thumbnailUri : medium.uri;
}
