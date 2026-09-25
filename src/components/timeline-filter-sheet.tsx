import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSQLiteContext } from 'expo-sqlite';

import { NumberWheelColumn, NUMBER_WHEEL_ITEM_HEIGHT } from '@/components/number-wheel-column';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { PrimaryButton } from '@/components/ui/buttons';
import {
  countEntriesMatchingFilters,
  listEntryFilterOptions,
  type EntryFilterKind,
  type EntryFilterOptions,
  type EntryListFilters,
} from '@/database/journal-repository';
import { JOURNAL_MOODS, JOURNAL_WEATHERS } from '@/domain/journal-metadata';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { encodeEntryDateRange, formatEntryDateRange, localDateKey, parseEntryDateRange, parseLocalDateKey } from '@/utils/entry-time-range';

type ActiveFilterKind = Exclude<EntryFilterKind, 'none'>;
type RangeEndpoint = 'start' | 'end';

const EMPTY_FILTER_OPTIONS: EntryFilterOptions = { locations: [], tags: [], moods: [], weather: [] };
const FILTER_KINDS: { kind: ActiveFilterKind; title: string }[] = [
  { kind: 'time', title: '时间' },
  { kind: 'location', title: '地点' },
  { kind: 'tag', title: '标签' },
  { kind: 'mood', title: '心情' },
  { kind: 'weather', title: '天气' },
];
const FILTER_LABELS: Record<ActiveFilterKind, string> = { time: '时间', location: '地点', tag: '标签', mood: '心情', weather: '天气' };

type TimelineFilterSheetProps = {
  filters: EntryListFilters;
  onClose: () => void;
  onApply: (filters: EntryListFilters) => void;
};

export function TimelineFilterSheet({ filters, onClose, onApply }: TimelineFilterSheetProps) {
  const db = useSQLiteContext();
  const { readingTheme } = useAppPreferences();
  const optionsRequestIdRef = useRef(0);
  const [filterOptions, setFilterOptions] = useState<EntryFilterOptions>(EMPTY_FILTER_OPTIONS);
  const [filterKind, setFilterKind] = useState<ActiveFilterKind>('time');
  const [pendingFilters, setPendingFilters] = useState<EntryListFilters>(filters);
  const [pendingFilterCount, setPendingFilterCount] = useState<number | null | 'error'>(null);
  const [filterSearch, setFilterSearch] = useState('');
  const [customRangeVisible, setCustomRangeVisible] = useState(false);
  const [rangeEndpoint, setRangeEndpoint] = useState<RangeEndpoint>('start');
  const [rangeStart, setRangeStart] = useState(() => defaultDateRange().start);
  const [rangeEnd, setRangeEnd] = useState(() => defaultDateRange().end);
  const [rangePickerYear, setRangePickerYear] = useState(new Date().getFullYear());
  const [rangePickerMonth, setRangePickerMonth] = useState(new Date().getMonth() + 1);
  const [rangePickerDay, setRangePickerDay] = useState(new Date().getDate());

  useEffect(() => {
    const currentRequest = ++optionsRequestIdRef.current;
    void listEntryFilterOptions(db)
      .then((options) => { if (currentRequest === optionsRequestIdRef.current) setFilterOptions(options); })
      .catch(() => { /* Keep the last successfully loaded options. */ });
    return () => { optionsRequestIdRef.current += 1; };
  }, [db]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void countEntriesMatchingFilters(db, pendingFilters)
        .then((count) => { if (active) setPendingFilterCount(count); })
        .catch(() => { if (active) setPendingFilterCount('error'); });
    }, 120);
    return () => { active = false; clearTimeout(timer); };
  }, [db, pendingFilters]);

  const availableMoods = useMemo(() => [...new Set<string>([...JOURNAL_MOODS, ...filterOptions.moods])], [filterOptions.moods]);
  const availableWeather = useMemo(() => [...new Set<string>([...JOURNAL_WEATHERS, ...filterOptions.weather])], [filterOptions.weather]);
  const valueOptions = filterKind === 'time'
    ? [{ value: 'today', label: '今天' }, { value: '7days', label: '最近 7 天' }, { value: '30days', label: '最近 30 天' }, { value: 'year', label: '今年' }]
    : filterKind === 'location' ? filterOptions.locations.map((value) => ({ value, label: `⌖ ${value}` }))
      : filterKind === 'tag' ? filterOptions.tags.map((value) => ({ value, label: `#${value}` }))
        : filterKind === 'mood' ? availableMoods.map((value) => ({ value, label: value }))
          : availableWeather.map((value) => ({ value, label: value }));
  const searchableFilter = (filterKind === 'location' || filterKind === 'tag') && valueOptions.length > 6;
  const visibleValueOptions = searchableFilter && filterSearch.trim()
    ? valueOptions.filter((option) => option.label.toLocaleLowerCase().includes(filterSearch.trim().toLocaleLowerCase()))
    : valueOptions;
  const pendingCustomRange = parseEntryDateRange(pendingFilters.time);
  const pendingActiveFilterCount = Object.values(pendingFilters).filter(Boolean).length;
  const rangeYears = useMemo(() => Array.from({ length: new Date().getFullYear() - 1899 }, (_, index) => 1900 + index), []);
  const rangeMonths = useMemo(() => Array.from({ length: 12 }, (_, index) => index + 1), []);
  const rangeDays = useMemo(() => Array.from({ length: daysInMonth(rangePickerYear, rangePickerMonth) }, (_, index) => index + 1), [rangePickerMonth, rangePickerYear]);

  function close() {
    Keyboard.dismiss();
    setFilterSearch('');
    onClose();
  }

  function chooseFilterKind(kind: ActiveFilterKind) {
    setFilterKind(kind);
    setFilterSearch('');
  }

  function setFilterValue(value: string) {
    setPendingFilterCount(null);
    setPendingFilters((current) => {
      const next = { ...current };
      if (current[filterKind] !== value) next[filterKind] = value;
      else delete next[filterKind];
      return next;
    });
  }

  function resetFilters() {
    setPendingFilterCount(null);
    setPendingFilters({});
    setFilterSearch('');
  }

  function applyFilters() {
    Keyboard.dismiss();
    setFilterSearch('');
    onApply(pendingFilters);
  }

  function setRangePickerFromKey(value: string) {
    const date = parseLocalDateKey(value) ?? new Date();
    setRangePickerYear(date.getFullYear());
    setRangePickerMonth(date.getMonth() + 1);
    setRangePickerDay(date.getDate());
  }

  function selectRangeEndpoint(endpoint: RangeEndpoint) {
    setRangeEndpoint(endpoint);
    setRangePickerFromKey(endpoint === 'start' ? rangeStart : rangeEnd);
  }

  function openCustomRange() {
    const current = parseEntryDateRange(pendingFilters.time) ?? defaultDateRange();
    setRangeStart(current.start);
    setRangeEnd(current.end);
    setRangeEndpoint('start');
    setRangePickerFromKey(current.start);
    setCustomRangeVisible(true);
  }

  function updateRangePicker(part: 'year' | 'month' | 'day', value: number) {
    const nextYear = part === 'year' ? value : rangePickerYear;
    const nextMonth = part === 'month' ? value : rangePickerMonth;
    const nextDay = Math.min(part === 'day' ? value : rangePickerDay, daysInMonth(nextYear, nextMonth));
    setRangePickerYear(nextYear);
    setRangePickerMonth(nextMonth);
    setRangePickerDay(nextDay);
    const nextKey = localDateKey(new Date(nextYear, nextMonth - 1, nextDay));
    if (rangeEndpoint === 'start') {
      setRangeStart(nextKey);
      if (nextKey > rangeEnd) setRangeEnd(nextKey);
    } else {
      setRangeEnd(nextKey);
      if (nextKey < rangeStart) setRangeStart(nextKey);
    }
  }

  function confirmCustomRange() {
    setPendingFilterCount(null);
    setPendingFilters((current) => ({ ...current, time: encodeEntryDateRange(rangeStart, rangeEnd) }));
    setCustomRangeVisible(false);
  }

  function clearCustomRange() {
    setPendingFilterCount(null);
    setPendingFilters((current) => { const next = { ...current }; delete next.time; return next; });
  }

  return <>
    <BottomSheet visible={!customRangeVisible} onClose={close} backgroundColor={readingTheme.background}>
      <View style={[styles.header, { borderBottomColor: readingTheme.border }]}><Text style={[styles.title, { color: readingTheme.text }]}>筛选记录</Text><Pressable accessibilityLabel="关闭筛选" hitSlop={10} onPress={close}><Text style={[styles.close, { color: readingTheme.secondary }]}>×</Text></Pressable></View>
      <View style={styles.body}><View style={[styles.kinds, { backgroundColor: readingTheme.surface }]}>
        {FILTER_KINDS.map(({ kind, title }) => <Pressable accessibilityRole="tab" accessibilityState={{ selected: kind === filterKind }} key={kind} onPress={() => chooseFilterKind(kind)} style={({ pressed }) => [styles.kind, kind === filterKind && { backgroundColor: readingTheme.background }, pressed && styles.pressed]}><Text numberOfLines={1} style={[styles.kindTitle, { color: kind === filterKind ? colors.primary : readingTheme.text }]}>{title}</Text>{pendingFilters[kind] ? <View style={styles.selectedDot} /> : null}</Pressable>)}
      </View>
      <View style={styles.values}>
        {searchableFilter ? <View style={[styles.searchBox, { backgroundColor: readingTheme.surface }]}><SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={15} tintColor={readingTheme.secondary} /><TextInput accessibilityLabel={`搜索${FILTER_LABELS[filterKind]}`} value={filterSearch} onChangeText={setFilterSearch} placeholder={`搜索${FILTER_LABELS[filterKind]}`} placeholderTextColor={readingTheme.secondary} style={[styles.searchInput, { color: readingTheme.text }]} /></View> : null}
        <ScrollView keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled" style={styles.valueScroll} showsVerticalScrollIndicator={valueOptions.length > 6} contentContainerStyle={styles.valueList}>
          {visibleValueOptions.map((option) => <Pressable accessibilityRole="menuitem" key={option.value} onPress={() => setFilterValue(option.value)} style={styles.value}><Text numberOfLines={1} ellipsizeMode="tail" style={[styles.valueText, { color: readingTheme.text }, pendingFilters[filterKind] === option.value && styles.valueTextActive]}>{option.label}</Text>{pendingFilters[filterKind] === option.value ? <Text style={styles.valueCheck}>✓</Text> : null}</Pressable>)}
          {filterKind === 'time' ? <Pressable accessibilityRole="menuitem" accessibilityState={{ selected: Boolean(pendingCustomRange) }} onPress={openCustomRange} style={styles.value}><View style={styles.customRangeLabel}><Text style={[styles.customRangeText, { color: readingTheme.text }, Boolean(pendingCustomRange) && styles.valueTextActive]}>自定义时间范围</Text>{pendingCustomRange ? <Text numberOfLines={1} style={[styles.customRangeSummary, { color: readingTheme.secondary }]}>{formatEntryDateRange(pendingFilters.time)}</Text> : null}</View>{pendingCustomRange ? <Pressable accessibilityLabel="取消自定义时间范围" hitSlop={10} onPress={(event) => { event.stopPropagation(); clearCustomRange(); }} style={styles.customRangeClear}><Text style={styles.customRangeClearText}>×</Text></Pressable> : <Text style={[styles.customRangeArrow, { color: readingTheme.secondary }]}>›</Text>}</Pressable> : null}
          {!visibleValueOptions.length ? <Text style={[styles.empty, { color: readingTheme.secondary }]}>{filterSearch.trim() ? '没有找到相关内容' : '还没有可筛选的内容'}</Text> : null}
        </ScrollView>
      </View></View>
      <View style={[styles.actions, { borderTopColor: readingTheme.border }]}><Pressable accessibilityRole="button" accessibilityHint="清空面板内尚未应用的全部筛选条件" onPress={resetFilters} style={[styles.reset, { borderColor: readingTheme.border }]}><Text style={[styles.resetText, { color: readingTheme.text }]}>重置</Text></Pressable><PrimaryButton accessibilityRole="button" onPress={applyFilters} style={styles.apply}><Text style={styles.applyText}>{pendingFilterCount === null ? '正在统计…' : pendingFilterCount === 'error' ? (pendingActiveFilterCount ? '查看筛选结果' : '查看全部记录') : pendingActiveFilterCount ? `查看 ${pendingFilterCount} 条记录` : '查看全部记录'}</Text></PrimaryButton></View>
    </BottomSheet>
    <BottomSheet visible={customRangeVisible} onClose={() => setCustomRangeVisible(false)} backgroundColor={readingTheme.background} contentHeight={350} scrollable>
      <View style={[styles.rangeHeader, { borderBottomColor: readingTheme.border }]}><Pressable hitSlop={12} onPress={() => setCustomRangeVisible(false)}><Text style={[styles.rangeHeaderAction, { color: readingTheme.secondary }]}>取消</Text></Pressable><Text style={[styles.rangeTitle, { color: readingTheme.text }]}>自定义时间范围</Text><Pressable hitSlop={12} onPress={confirmCustomRange}><Text style={styles.rangeHeaderAction}>确定</Text></Pressable></View>
      <View style={styles.rangeEndpoints}><Pressable accessibilityLabel="选择开始日期" accessibilityState={{ selected: rangeEndpoint === 'start' }} onPress={() => selectRangeEndpoint('start')} style={[styles.rangeEndpoint, { backgroundColor: readingTheme.surface }, rangeEndpoint === 'start' && styles.rangeEndpointActive]}><Text style={[styles.rangeEndpointValue, { color: rangeEndpoint === 'start' ? colors.primary : readingTheme.text }]}>{rangeStart.replace(/-/g, '.')}</Text></Pressable><Text style={[styles.rangeSeparator, { color: readingTheme.secondary }]}>至</Text><Pressable accessibilityLabel="选择结束日期" accessibilityState={{ selected: rangeEndpoint === 'end' }} onPress={() => selectRangeEndpoint('end')} style={[styles.rangeEndpoint, { backgroundColor: readingTheme.surface }, rangeEndpoint === 'end' && styles.rangeEndpointActive]}><Text style={[styles.rangeEndpointValue, { color: rangeEndpoint === 'end' ? colors.primary : readingTheme.text }]}>{rangeEnd.replace(/-/g, '.')}</Text></Pressable></View>
      <View style={styles.timeWheel}><View pointerEvents="none" style={[styles.timeWheelSelection, { borderColor: readingTheme.border }]} /><NumberWheelColumn values={rangeYears} selected={rangePickerYear} suffix="年" onSelect={(value) => updateRangePicker('year', value)} /><NumberWheelColumn values={rangeMonths} selected={rangePickerMonth} suffix="月" onSelect={(value) => updateRangePicker('month', value)} /><NumberWheelColumn values={rangeDays} selected={rangePickerDay} suffix="日" onSelect={(value) => updateRangePicker('day', value)} /></View>
      <Text style={[styles.rangeHint, { color: readingTheme.secondary }]}>包含开始日期和结束日期当天</Text>
    </BottomSheet>
  </>;
}

function defaultDateRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 29);
  return { start: localDateKey(start), end: localDateKey(end) };
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

const styles = StyleSheet.create({
  header: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth }, title: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, close: { fontSize: 25, lineHeight: 30, fontWeight: '300' },
  body: { minHeight: 0, flex: 1, flexDirection: 'row' }, kinds: { width: 106, paddingTop: spacing.xs }, kind: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg }, kindTitle: { flexShrink: 1, fontSize: 11, fontWeight: '600' }, selectedDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary }, pressed: { opacity: 0.62 },
  values: { minWidth: 0, flex: 1, paddingTop: spacing.sm }, searchBox: { height: 38, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.sm, marginVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radii.sm }, searchInput: { flex: 1, height: 38, paddingVertical: 0, fontSize: 12 }, valueScroll: { flex: 1 }, valueList: { paddingHorizontal: spacing.sm, paddingBottom: spacing.sm }, value: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, valueText: { flex: 1, fontSize: 11, lineHeight: 16 }, customRangeText: { fontSize: 11, lineHeight: 16 }, valueTextActive: { color: colors.primary, fontWeight: '700' }, valueCheck: { color: colors.primary, fontSize: 13, fontWeight: '700' }, empty: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xl, fontSize: 10, lineHeight: 16, textAlign: 'center' },
  customRangeLabel: { minWidth: 0, flex: 1, justifyContent: 'center', gap: 2 }, customRangeSummary: { fontSize: 9, lineHeight: 13 }, customRangeClear: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.primarySoft }, customRangeClearText: { color: colors.primary, fontSize: 18, lineHeight: 20 }, customRangeArrow: { fontSize: 20, lineHeight: 24 },
  actions: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth }, reset: { width: 86, height: 42, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.pill }, resetText: { fontSize: 11, fontWeight: '700' }, apply: { flex: 1, height: 42 }, applyText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  rangeHeader: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth }, rangeTitle: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '700' }, rangeHeaderAction: { minWidth: 44, color: colors.primary, fontSize: 14, fontWeight: '600' },
  rangeEndpoints: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingTop: spacing.md }, rangeEndpoint: { minWidth: 0, flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent', borderRadius: radii.md }, rangeEndpointActive: { borderColor: colors.primary }, rangeEndpointValue: { fontSize: 12, lineHeight: 16, fontWeight: '700' }, rangeSeparator: { fontSize: 10 }, rangeHint: { marginTop: spacing.xs, fontSize: 9, lineHeight: 13, textAlign: 'center' },
  timeWheel: { height: 176, overflow: 'hidden', flexDirection: 'row', marginTop: spacing.md, paddingHorizontal: spacing.lg }, timeWheelSelection: { position: 'absolute', left: spacing.lg, right: spacing.lg, top: 66, height: NUMBER_WHEEL_ITEM_HEIGHT, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
});
