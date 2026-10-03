import type { TimePixelSnapshot, TimePixelSettings, TimePixelUnit, TimePixelRange } from '../database/time-pixel-repository.ts';

export type PixelGroup = {
  key: string;
  startDate: string;
  endDate: string;
  counts: Map<string, number>;
  elapsedDays: number;
  totalDays: number;
  hasStageStart: boolean;
  hasNote: boolean;
};

function utcTime(value: string) { return Date.parse(`${value}T00:00:00Z`); }
function nextDate(value: string) { return new Date(utcTime(value) + 86_400_000).toISOString().slice(0, 10); }

function rangeBounds(settings: TimePixelSettings, today: string) {
  if (settings.rangeMode === 'year' && settings.selectedYear) {
    const start = `${settings.selectedYear}-01-01`;
    return { start: settings.originDate > start ? settings.originDate : start, end: `${settings.selectedYear}-12-31` };
  }
  return { start: settings.originDate, end: today };
}

export function buildPixelGroups(snapshot: TimePixelSnapshot, settings: TimePixelSettings, today: string) {
  const { start, end } = rangeBounds(settings, today);
  const assignments = new Map<string, TimePixelRange>();
  const relevant = snapshot.ranges
    .filter((range) => range.kind === settings.colorMode)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.createdAt.localeCompare(b.createdAt));
  for (const range of relevant) {
    const first = range.startDate > start ? range.startDate : start;
    const last = range.endDate < end ? range.endDate : end;
    if (first > last) continue;
    for (let value = first; value <= last; value = nextDate(value)) assignments.set(value, range);
  }
  // Range rows can be split when a note or overlap is edited. A stage marker is
  // a real category transition, not merely the start of one of those fragments.
  const stageAssignments = new Map<string, TimePixelRange>();
  const dayBeforeStart = new Date(utcTime(start) - 86_400_000).toISOString().slice(0, 10);
  const stages = snapshot.ranges
    .filter((range) => range.kind === 'stage')
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.createdAt.localeCompare(b.createdAt));
  for (const range of stages) {
    const first = range.startDate > dayBeforeStart ? range.startDate : dayBeforeStart;
    const last = range.endDate < end ? range.endDate : end;
    if (first > last) continue;
    for (let value = first; value <= last; value = nextDate(value)) stageAssignments.set(value, range);
  }
  // Notes belong to whole ranges; mark every intersecting day, in either layer.
  const notedDays = new Set<string>();
  for (const range of snapshot.ranges.filter((item) => item.note?.trim())) {
    const first = range.startDate > start ? range.startDate : start;
    const last = [range.endDate, end, today].sort()[0];
    for (let value = first; value <= last; value = nextDate(value)) notedDays.add(value);
  }
  const groups = new Map<string, PixelGroup>();
  const totals = new Map<string, number>();
  let recordedDays = 0;
  let elapsedDays = 0;
  let futureDays = 0;
  let previousStageId = stageAssignments.get(dayBeforeStart)?.categoryId ?? null;
  for (let value = start; value <= end; value = nextDate(value)) {
    const future = value > today;
    const range = future ? null : assignments.get(value) ?? null;
    const stageId = future ? null : stageAssignments.get(value)?.categoryId ?? null;
    const categoryId = future ? '__future' : range?.categoryId ?? '__unknown';
    if (future) futureDays += 1;
    else {
      elapsedDays += 1;
      if (range) { recordedDays += 1; totals.set(range.categoryId, (totals.get(range.categoryId) ?? 0) + 1); }
    }
    const key = settings.unit === 'day' ? value : settings.unit === 'month' ? value.slice(0, 7) : value.slice(0, 4);
    const existing = groups.get(key) ?? { key, startDate: value, endDate: value, counts: new Map(), elapsedDays: 0, totalDays: 0, hasStageStart: false, hasNote: false };
    existing.endDate = value;
    existing.totalDays += 1;
    if (!future) existing.elapsedDays += 1;
    existing.counts.set(categoryId, (existing.counts.get(categoryId) ?? 0) + 1);
    existing.hasStageStart ||= !future && stageId !== null && stageId !== previousStageId;
    existing.hasNote ||= notedDays.has(value);
    groups.set(key, existing);
    previousStageId = stageId;
  }
  return { groups: [...groups.values()], totals, recordedDays, elapsedDays, futureDays, bounds: { start, end } };
}

export function buildPixelSections(groups: PixelGroup[], unit: TimePixelUnit, columns: number) {
  if (!Number.isInteger(columns) || columns < 1) throw new Error('invalid-pixel-columns');
  const byYear = new Map<string, PixelGroup[]>();
  for (const group of groups) {
    const key = unit === 'year' ? 'overview' : group.startDate.slice(0, 4);
    const section = byYear.get(key) ?? [];
    section.push(group);
    byYear.set(key, section);
  }
  return [...byYear].map(([key, items]) => ({
    key,
    year: key === 'overview' ? null : Number(key),
    title: key === 'overview' ? '年份总览' : `${key}年`,
    data: Array.from({ length: Math.ceil(items.length / columns) }, (_, index) => items.slice(index * columns, (index + 1) * columns)),
  }));
}

export function focusedPixelFill(group: PixelGroup, categoryId: string) {
  const focusedDays = group.counts.get(categoryId) ?? 0;
  return {
    elapsedDays: group.elapsedDays,
    futureDays: Math.max(0, group.totalDays - group.elapsedDays),
    opacity: focusedDays && group.elapsedDays ? 0.12 + 0.88 * focusedDays / group.elapsedDays : 0,
  };
}
