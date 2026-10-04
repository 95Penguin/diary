import type { TimePixelRange, TimePixelSettings } from '../database/time-pixel-repository.ts';

export const EARLIEST_TIME_PIXEL_YEAR = 1900;
export const EARLIEST_TIME_PIXEL_DATE = `${EARLIEST_TIME_PIXEL_YEAR}-01-01`;

export function isTimePixelDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < EARLIEST_TIME_PIXEL_DATE) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function normalizeTimePixelSettings(settings: TimePixelSettings, today: string): TimePixelSettings {
  if (settings.rangeMode !== 'year' || !Number.isInteger(settings.selectedYear)
    || settings.selectedYear! < EARLIEST_TIME_PIXEL_YEAR
    || settings.selectedYear! > Number(today.slice(0, 4))) {
    return { ...settings, rangeMode: 'all', selectedYear: null };
  }
  return settings;
}

function shiftDate(value: string, days: number) {
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

// Newer edits win only the overlapping days. Equal timestamps keep local data.
// Preserve timestamps when splitting so an old backup cannot become a newer edit.
export function mergeTimePixelRanges(local: TimePixelRange[], incoming: TimePixelRange[]) {
  const candidates = new Map(local.map((range) => [range.id, { range, local: true }]));
  for (const range of incoming) {
    const existing = candidates.get(range.id);
    if (!existing || range.updatedAt > existing.range.updatedAt) candidates.set(range.id, { range, local: false });
  }
  const ordered = [...candidates.values()].sort((a, b) =>
    b.range.updatedAt.localeCompare(a.range.updatedAt) || Number(b.local) - Number(a.local)
    || b.range.createdAt.localeCompare(a.range.createdAt) || a.range.id.localeCompare(b.range.id));
  const reservedIds = new Set(candidates.keys());
  const result: TimePixelRange[] = [];
  for (const { range } of ordered) {
    let pieces = [{ startDate: range.startDate, endDate: range.endDate }];
    for (const winner of result) {
      if (winner.kind !== range.kind) continue;
      pieces = pieces.flatMap((piece) => {
        if (winner.endDate < piece.startDate || winner.startDate > piece.endDate) return [piece];
        const remaining = [];
        if (piece.startDate < winner.startDate) remaining.push({ startDate: piece.startDate, endDate: shiftDate(winner.startDate, -1) });
        if (piece.endDate > winner.endDate) remaining.push({ startDate: shiftDate(winner.endDate, 1), endDate: piece.endDate });
        return remaining;
      });
    }
    pieces.forEach((piece, index) => {
      let id = range.id;
      if (index > 0) {
        const base = `${range.id}:split:${piece.startDate}`;
        id = base;
        let suffix = 1;
        while (reservedIds.has(id)) id = `${base}:${suffix++}`;
        reservedIds.add(id);
      }
      result.push({ ...range, ...piece, id });
    });
  }
  return result.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
}
