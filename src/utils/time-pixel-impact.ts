import type { TimePixelKind, TimePixelRange } from '../database/time-pixel-repository.ts';

type Draft = { kind: TimePixelKind; startDate: string; endDate: string; id?: string; note?: string | null };
function days(start: string, end: string) {
  return start > end ? 0 : Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

export function timePixelSaveImpact(ranges: TimePixelRange[], draft: Draft) {
  const affected = ranges.filter((range) => range.id === draft.id || (range.kind === draft.kind && range.startDate <= draft.endDate && range.endDate >= draft.startDate));
  const overlaps = affected.filter((range) => range.id !== draft.id);
  const byCategory = new Map<string, number>();
  let overwrittenDays = 0;
  let changedNotes = 0;
  for (const range of overlaps) {
    const count = days(range.startDate > draft.startDate ? range.startDate : draft.startDate, range.endDate < draft.endDate ? range.endDate : draft.endDate);
    overwrittenDays += count;
    byCategory.set(range.categoryId, (byCategory.get(range.categoryId) ?? 0) + count);
    if (range.note?.trim() && range.note.trim() !== (draft.note?.trim() ?? '')) changedNotes += 1;
  }
  const original = affected.find((range) => range.id === draft.id);
  const removedDays = original ? days(original.startDate, original.endDate) - days(
    original.startDate > draft.startDate ? original.startDate : draft.startDate,
    original.endDate < draft.endDate ? original.endDate : draft.endDate,
  ) : 0;
  return {
    totalDays: days(draft.startDate, draft.endDate), overwrittenDays, changedNotes, removedDays,
    byCategory: [...byCategory].map(([categoryId, count]) => ({ categoryId, days: count })),
    // Revalidate this fingerprint inside the write transaction after confirmation.
    signature: JSON.stringify(affected.slice().sort((a, b) => a.id.localeCompare(b.id)).map((range) => [range.id, range.kind, range.categoryId, range.startDate, range.endDate, range.note, range.updatedAt])),
  };
}
