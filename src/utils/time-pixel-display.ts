import type { TimePixelSnapshot, TimePixelSettings, TimePixelUnit, TimePixelRange } from '../database/time-pixel-repository.ts';

export type PixelGroup = {
  key: string;
  startDate: string;
  endDate: string;
  counts: Map<string, number>;
  elapsedDays: number;
  totalDays: number;
  hasNote: boolean;
};

function utcTime(value: string) { return Date.parse(`${value}T00:00:00Z`); }
function nextDate(value: string) { return new Date(utcTime(value) + 86_400_000).toISOString().slice(0, 10); }
function previousDate(value: string) { return new Date(utcTime(value) - 86_400_000).toISOString().slice(0, 10); }
function inclusiveDays(start: string, end: string) { return Math.floor((utcTime(end) - utcTime(start)) / 86_400_000) + 1; }

function rangeBounds(settings: TimePixelSettings, today: string) {
  if (settings.rangeMode === 'year' && settings.selectedYear) {
    return { start: `${settings.selectedYear}-01-01`, end: `${settings.selectedYear}-12-31` };
  }
  return { start: settings.originDate, end: settings.endYear ? `${settings.endYear}-12-31` : today };
}

type EffectiveRange = Pick<TimePixelRange, 'categoryId' | 'startDate' | 'endDate'>;
type DateInterval = Pick<TimePixelRange, 'startDate' | 'endDate'>;

function clippedRanges(ranges: TimePixelRange[], start: string, end: string) {
  return ranges.flatMap((range) => {
    const startDate = range.startDate > start ? range.startDate : start;
    const endDate = range.endDate < end ? range.endDate : end;
    return startDate <= endDate ? [{ ...range, startDate, endDate }] : [];
  });
}

function effectiveRanges(ranges: TimePixelRange[], start: string, end: string): EffectiveRange[] {
  const clipped = clippedRanges(ranges, start, end);
  const chronological = [...clipped].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  if (chronological.every((range, index) => index === 0 || chronological[index - 1].endDate < range.startDate)) return chronological;

  // Stored ranges normally do not overlap. Preserve the existing "newer edit
  // wins" behavior for restored or legacy data that still contains overlaps.
  const ordered = [...clipped].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.createdAt.localeCompare(b.createdAt));
  let result: EffectiveRange[] = [];
  for (const range of ordered) {
    const remaining: EffectiveRange[] = [];
    for (const existing of result) {
      if (existing.endDate < range.startDate || existing.startDate > range.endDate) {
        remaining.push(existing);
        continue;
      }
      if (existing.startDate < range.startDate) remaining.push({ ...existing, endDate: previousDate(range.startDate) });
      if (existing.endDate > range.endDate) remaining.push({ ...existing, startDate: nextDate(range.endDate) });
    }
    result = [...remaining, range];
  }
  return result.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
}

function noteIntervals(ranges: TimePixelRange[], start: string, end: string): DateInterval[] {
  const notes = clippedRanges(ranges.filter((range) => range.note?.trim()), start, end)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  const merged: DateInterval[] = [];
  for (const note of notes) {
    const previous = merged.at(-1);
    if (!previous || note.startDate > nextDate(previous.endDate)) merged.push({ startDate: note.startDate, endDate: note.endDate });
    else if (note.endDate > previous.endDate) previous.endDate = note.endDate;
  }
  return merged;
}

function groupKey(value: string, unit: Exclude<TimePixelUnit, 'day'>) {
  return unit === 'month' ? value.slice(0, 7) : value.slice(0, 4);
}

function calendarGroupEnd(value: string, unit: Exclude<TimePixelUnit, 'day'>) {
  if (unit === 'year') return `${value.slice(0, 4)}-12-31`;
  const [year, month] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function buildDayGroups(start: string, end: string, today: string, assignments: EffectiveRange[], notes: DateInterval[]) {
  const groups: PixelGroup[] = [];
  const totals = new Map<string, number>();
  let assignmentIndex = 0;
  let noteIndex = 0;
  let recordedDays = 0;
  let elapsedDays = 0;
  let futureDays = 0;
  for (let value = start; value <= end; value = nextDate(value)) {
    while (assignments[assignmentIndex]?.endDate < value) assignmentIndex += 1;
    while (notes[noteIndex]?.endDate < value) noteIndex += 1;
    const future = value > today;
    const assignment = !future && assignments[assignmentIndex]?.startDate <= value ? assignments[assignmentIndex] : null;
    const categoryId = future ? '__future' : assignment?.categoryId ?? '__unknown';
    if (future) futureDays += 1;
    else {
      elapsedDays += 1;
      if (assignment) {
        recordedDays += 1;
        totals.set(assignment.categoryId, (totals.get(assignment.categoryId) ?? 0) + 1);
      }
    }
    groups.push({
      key: value,
      startDate: value,
      endDate: value,
      counts: new Map([[categoryId, 1]]),
      elapsedDays: future ? 0 : 1,
      totalDays: 1,
      hasNote: !future && notes[noteIndex]?.startDate <= value,
    });
  }
  return { groups, totals, recordedDays, elapsedDays, futureDays, bounds: { start, end } };
}

function buildAggregateGroups(start: string, end: string, today: string, unit: Exclude<TimePixelUnit, 'day'>, assignments: EffectiveRange[], notes: DateInterval[]) {
  const groups: PixelGroup[] = [];
  const groupsByKey = new Map<string, PixelGroup>();
  for (let cursor = start; cursor <= end;) {
    const naturalEnd = calendarGroupEnd(cursor, unit);
    const groupEnd = naturalEnd < end ? naturalEnd : end;
    const totalDays = inclusiveDays(cursor, groupEnd);
    const elapsedEnd = groupEnd < today ? groupEnd : today;
    const elapsedDays = cursor <= elapsedEnd ? inclusiveDays(cursor, elapsedEnd) : 0;
    const futureDays = totalDays - elapsedDays;
    const counts = new Map<string, number>();
    if (elapsedDays) counts.set('__unknown', elapsedDays);
    if (futureDays) counts.set('__future', futureDays);
    const group: PixelGroup = { key: groupKey(cursor, unit), startDate: cursor, endDate: groupEnd, counts, elapsedDays, totalDays, hasNote: false };
    groups.push(group);
    groupsByKey.set(group.key, group);
    cursor = nextDate(groupEnd);
  }

  const totals = new Map<string, number>();
  let recordedDays = 0;
  for (const assignment of assignments) {
    for (let cursor = assignment.startDate; cursor <= assignment.endDate;) {
      const group = groupsByKey.get(groupKey(cursor, unit));
      if (!group) break;
      const partEnd = assignment.endDate < group.endDate ? assignment.endDate : group.endDate;
      const days = inclusiveDays(cursor, partEnd);
      const unknown = (group.counts.get('__unknown') ?? 0) - days;
      if (unknown > 0) group.counts.set('__unknown', unknown);
      else group.counts.delete('__unknown');
      group.counts.set(assignment.categoryId, (group.counts.get(assignment.categoryId) ?? 0) + days);
      totals.set(assignment.categoryId, (totals.get(assignment.categoryId) ?? 0) + days);
      recordedDays += days;
      cursor = nextDate(partEnd);
    }
  }
  for (const note of notes) {
    for (let cursor = note.startDate; cursor <= note.endDate;) {
      const group = groupsByKey.get(groupKey(cursor, unit));
      if (!group) break;
      group.hasNote = true;
      cursor = nextDate(note.endDate < group.endDate ? note.endDate : group.endDate);
    }
  }
  const elapsedDays = groups.reduce((total, group) => total + group.elapsedDays, 0);
  const futureDays = groups.reduce((total, group) => total + group.totalDays - group.elapsedDays, 0);
  return { groups, totals, recordedDays, elapsedDays, futureDays, bounds: { start, end } };
}

export function buildPixelGroups(snapshot: TimePixelSnapshot, settings: TimePixelSettings, today: string) {
  const { start, end } = rangeBounds(settings, today);
  const elapsedEnd = end < today ? end : today;
  const assignments = start <= elapsedEnd
    ? effectiveRanges(snapshot.ranges.filter((range) => range.kind === settings.colorMode), start, elapsedEnd)
    : [];
  const notes = start <= elapsedEnd ? noteIntervals(snapshot.ranges, start, elapsedEnd) : [];
  return settings.unit === 'day'
    ? buildDayGroups(start, end, today, assignments, notes)
    : buildAggregateGroups(start, end, today, settings.unit, assignments, notes);
}

export function labelForPixelGroup(group: Pick<PixelGroup, 'key' | 'startDate'>, unit: TimePixelUnit) {
  if (unit === 'year') return group.key;
  if (unit === 'month') return `${Number(group.key.slice(5))}月`;
  return group.startDate.endsWith('-01') ? `${Number(group.startDate.slice(5, 7))}` : '';
}

export function hasTimePixelRangeOnDate(ranges: TimePixelRange[], kind: TimePixelRange['kind'], date: string) {
  return ranges.some((range) => range.kind === kind && range.startDate <= date && range.endDate >= date);
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
