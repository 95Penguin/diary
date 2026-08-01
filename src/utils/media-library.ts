import type { LibraryMedia } from '@/domain/journal';

export type MediaLibraryFilter = 'all' | 'image' | 'video';
export type MediaLibraryListItem =
  | { kind: 'header'; key: string; label: string; count: number }
  | { kind: 'row'; key: string; media: LibraryMedia[] };

export function isVideoMedia(media: Pick<LibraryMedia, 'mediaType' | 'duration' | 'uri'>) {
  return media.mediaType === 'video'
    || Boolean(media.duration && media.duration > 0)
    || /\.(mp4|mov|m4v|webm)(?:$|\?)/i.test(media.uri);
}

export function filterLibraryMedia(media: LibraryMedia[], filter: MediaLibraryFilter) {
  if (filter === 'all') return media;
  return media.filter((item) => filter === 'video' ? isVideoMedia(item) : !isVideoMedia(item));
}

export function buildMediaLibraryRows(media: LibraryMedia[], columns = 3): MediaLibraryListItem[] {
  const groups = new Map<string, { label: string; media: LibraryMedia[] }>();
  for (const item of media) {
    const date = new Date(item.occurredAt);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const group = groups.get(key) ?? { label: `${year} 年 ${month} 月`, media: [] };
    group.media.push(item);
    groups.set(key, group);
  }
  return [...groups.entries()].flatMap(([key, group]) => {
    const rows: MediaLibraryListItem[] = [{ kind: 'header', key: `header-${key}`, label: group.label, count: group.media.length }];
    for (let index = 0; index < group.media.length; index += columns) {
      rows.push({ kind: 'row', key: `${key}-${index}`, media: group.media.slice(index, index + columns) });
    }
    return rows;
  });
}
