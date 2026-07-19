const DAY_MS = 24 * 60 * 60 * 1000;

export function formatTime(iso: string) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

export function formatFullDate(iso: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

export function formatShortDateTime(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return `今天 ${formatTime(iso)}`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

export function groupLabel(iso: string) {
  const date = startOfDay(new Date(iso));
  const today = startOfDay(new Date());
  const diff = Math.round((today.getTime() - date.getTime()) / DAY_MS);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (date.getFullYear() === today.getFullYear()) return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

export function weekdayLabel(iso: string) {
  return new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(new Date(iso));
}

export function toLocalDateTimeInput(iso: string) {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseLocalDateTime(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  if (
    date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day) ||
    date.getHours() !== Number(hour) || date.getMinutes() !== Number(minute)
  ) return null;
  return date.toISOString();
}

export function occurrenceTimeForDate(dateValue: string, now = new Date()) {
  const match = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return now.toISOString();
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), now.getHours(), now.getMinutes());
  if (
    date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)
  ) return now.toISOString();
  return date.toISOString();
}

export function dateKey(iso: string) {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfDay(date: Date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
