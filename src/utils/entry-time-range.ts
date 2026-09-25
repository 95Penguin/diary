export type EntryDateRange = {
  start: string;
  end: string;
};

const RANGE_PREFIX = 'range:';
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseLocalDateKey(value: string) {
  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

export function encodeEntryDateRange(start: string, end: string) {
  return `${RANGE_PREFIX}${start}:${end}`;
}

export function parseEntryDateRange(value: string | null | undefined): EntryDateRange | null {
  if (!value?.startsWith(RANGE_PREFIX)) return null;
  const [start, end, extra] = value.slice(RANGE_PREFIX.length).split(':');
  const startDate = parseLocalDateKey(start ?? '');
  const endDate = parseLocalDateKey(end ?? '');
  if (extra != null || !startDate || !endDate || startDate.getTime() > endDate.getTime()) return null;
  return { start, end };
}

export function formatEntryDateRange(value: string | null | undefined) {
  const range = parseEntryDateRange(value);
  if (!range) return null;
  const compact = (date: string) => date.replace(/-/g, '.');
  return `${compact(range.start)} — ${compact(range.end)}`;
}
