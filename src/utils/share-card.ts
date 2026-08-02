import type { Entry } from '@/domain/journal';

export const SHARE_CARD_CONTENT_LIMIT = 420;
export const SHARE_CARD_PAGE_LIMIT = 900;
export const SHARE_CARD_MAX_PAGES = 20;

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

export function shareCardPages(content: string, limit = SHARE_CARD_PAGE_LIMIT) {
  const pages: string[] = [];
  let rest = content.trim();
  if (!rest) return [''];
  while (visualLength(rest) > limit) {
    let cutoff = 0; let weight = 0;
    while (cutoff < rest.length && weight < limit) { weight += rest[cutoff] === '\n' ? 24 : 1; cutoff += 1; }
    const window = rest.slice(0, cutoff);
    const split = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('。'), window.lastIndexOf('！'), window.lastIndexOf('？'));
    const end = split >= Math.floor(cutoff * 0.55) ? split + 1 : cutoff;
    pages.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trimStart();
  }
  if (rest) pages.push(rest);
  return pages;
}

function visualLength(value: string) {
  return [...value].reduce((total, character) => total + (character === '\n' ? 24 : 1), 0);
}
