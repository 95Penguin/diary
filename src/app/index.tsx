import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, InteractionManager, Modal, PanResponder, Platform, Pressable, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { BottomNavigation, type HomeView } from '@/components/bottom-navigation';
import { NUMBER_WHEEL_ITEM_HEIGHT, NumberWheelColumn } from '@/components/number-wheel-column';
import { showAppDialog } from '@/components/app-dialog-host';
import { EmptyState } from '@/components/empty-state';
import { EntryCard } from '@/components/entry-card';
import { EntryActionModal } from '@/components/entry-action-modal';
import {
  cleanupExpiredTrash,
  countEntriesForLocalDate,
  deleteEntry,
  getDraftCount,
  getEntry,
  getCalendarOrder,
  listCalendarMonthCounts,
  listEntriesForDate,
  listEntryFilterOptions,
  listEntryMonthIndex,
  findTimelineJumpTarget,
  listNewerEntryPage,
  listEntryPage,
  listReferencedMediaUris,
  saveCalendarOrder,
  type EntryFilterKind,
  type EntryFilterOptions,
  type EntryListFilters,
  type EntryPageCursor,
  type EntryMonthIndexItem,
} from '@/database/journal-repository';
import type { Entry } from '@/domain/journal';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { dateKey, groupLabel, weekdayLabel } from '@/utils/date';
import { lunarDayLabel } from '@/utils/lunar';
import { cleanupUnusedJournalMedia, deleteJournalImage } from '@/utils/image-storage';
import { useAppPreferences } from '@/preferences/app-preferences';
import { finishStartupMetric, startupTimer } from '@/utils/startup-performance';
import { cleanupExpiredTimeCapsules } from '@/database/time-capsule-repository';
import { recordAppError } from '@/utils/app-error-log';

export default function HomeScreen() {
  const db = useSQLiteContext();
  const { preferences, readingTheme } = useAppPreferences();
  const todayKey = dateKey(new Date().toISOString());
  const [refreshKey, setRefreshKey] = useState(0);
  const [view, setView] = useState<HomeView>('timeline');
  const [timelineScrollRequest, setTimelineScrollRequest] = useState(0);
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [actionEntry, setActionEntry] = useState<Entry | null>(null);
  const [draftCount, setDraftCount] = useState(0);
  const [quickHintVisible, setQuickHintVisible] = useState(false);
  const cleanupStarted = useRef(false);
  const pendingDetailEntryId = useRef<string | null>(null);
  const [entryRefresh, setEntryRefresh] = useState<{ id: string; revision: number } | null>(null);

  const refresh = useCallback(async () => {
    const returningEntryId = pendingDetailEntryId.current;
    pendingDetailEntryId.current = null;
    if (returningEntryId) {
      setEntryRefresh((current) => ({ id: returningEntryId, revision: (current?.revision ?? 0) + 1 }));
    } else {
      setRefreshKey((value) => value + 1);
    }
    void getDraftCount(db).then(setDraftCount);
    if (!cleanupStarted.current) {
      cleanupStarted.current = true;
      InteractionManager.runAfterInteractions(() => {
        void cleanupExpiredTrash(db)
          .then((expiredImages) => expiredImages.forEach(deleteJournalImage))
          .catch(() => { /* Cleanup is best-effort and must not block the timeline. */ });
        void cleanupExpiredTimeCapsules(db)
          .then((expiredMedia) => expiredMedia.forEach(deleteJournalImage))
          .catch(() => { /* Cleanup is best-effort and must not block the timeline. */ });
        void listReferencedMediaUris(db)
          .then((uris) => cleanupUnusedJournalMedia(uris))
          .catch(() => { /* Cleanup is best-effort and must not block the timeline. */ });
      });
    }
  }, [db]);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  useEffect(() => {
    let active = true;
    void db.getFirstAsync<{ value: string }>("SELECT value FROM kv_store WHERE key = 'quick-compose-hint-seen'").then((row) => {
      if (active && !row) setQuickHintVisible(true);
    });
    return () => { active = false; };
  }, [db]);

  function dismissQuickHint() {
    setQuickHintVisible(false);
    void db.runAsync("INSERT OR REPLACE INTO kv_store (key, value) VALUES ('quick-compose-hint-seen', '1')");
  }

  const openEntryActions = useCallback((entry: Entry) => {
    setActionEntry(entry);
  }, []);

  const openEntry = useCallback((entry: Entry) => {
    pendingDetailEntryId.current = entry.id;
    router.push({ pathname: '/entry/[id]', params: { id: entry.id } });
  }, []);

  async function deleteSelectedEntry() {
    if (!actionEntry) return;
    try {
      await deleteEntry(db, actionEntry.id);
      setRefreshKey((value) => value + 1);
      setActionEntry(null);
    } catch { await showAppDialog({ title: '移入失败', message: '记录暂时无法移入回收站，请稍后重试。' }); }
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: readingTheme.background }]}>
      <View style={styles.header}>
        <View style={styles.headerIdentity}><Text style={[styles.brand, { color: readingTheme.text }]}>拾时</Text><Text numberOfLines={1} style={[styles.subtitle, { color: readingTheme.secondary }]}>{preferences.signature.trim() || '我的日迹'}</Text></View>
        <View style={styles.headerActions}>
          <Pressable accessibilityLabel={`草稿箱${draftCount > 0 ? `，${draftCount} 份草稿` : ''}`} onPress={() => router.push('/drafts' as Href)} style={[styles.searchButton, { backgroundColor: readingTheme.surface }]}><SymbolView name={{ ios: 'doc.text', android: 'draft', web: 'draft' }} size={18} tintColor={colors.primary} />{draftCount > 0 ? <View style={styles.draftDot} /> : null}</Pressable>
          <Pressable accessibilityLabel="搜索" onPress={() => router.push('/search')} style={[styles.searchButton, { backgroundColor: readingTheme.surface }]}><SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={19} tintColor={colors.primary} /></Pressable>
          <Pressable accessibilityLabel={`我的，${preferences.nickname}`} onPress={() => router.push('/settings')} style={styles.profileButton}>{preferences.avatarUri ? <Image source={preferences.avatarUri} contentFit="cover" style={styles.profileImage} /> : <Text style={styles.profileText}>{preferences.nickname.slice(0, 1)}</Text>}</Pressable>
        </View>
      </View>

      <View style={styles.content}>
        <View accessibilityElementsHidden={view !== 'timeline'} importantForAccessibility={view === 'timeline' ? 'auto' : 'no-hide-descendants'} pointerEvents={view === 'timeline' ? 'auto' : 'none'} style={[styles.viewPane, view !== 'timeline' && styles.hiddenPane]}><Timeline refreshKey={refreshKey} entryRefresh={entryRefresh} scrollRequest={timelineScrollRequest} onOpen={openEntry} onLongPress={openEntryActions} /></View>
        <View accessibilityElementsHidden={view !== 'calendar'} importantForAccessibility={view === 'calendar' ? 'auto' : 'no-hide-descendants'} pointerEvents={view === 'calendar' ? 'auto' : 'none'} style={[styles.viewPane, view !== 'calendar' && styles.hiddenPane]}><CalendarView refreshKey={refreshKey} entryRefresh={entryRefresh} selected={selectedDate} onSelect={setSelectedDate} onOpen={openEntry} onLongPress={openEntryActions} /></View>
      </View>

      {quickHintVisible ? <Pressable accessibilityRole="button" accessibilityLabel="知道了" onPress={dismissQuickHint} style={[styles.quickHint, { backgroundColor: readingTheme.surface }]}><Text style={[styles.quickHintText, { color: readingTheme.secondary }]}>长按“＋”可以直接进入快速记录</Text><Text style={styles.quickHintClose}>知道了</Text></Pressable> : null}
      <BottomNavigation view={view} onChange={(nextView) => {
        if (nextView === 'timeline' && view === 'timeline') setTimelineScrollRequest((value) => value + 1);
        else setView(nextView);
      }} onCompose={() => {
        if (view === 'calendar') router.push({ pathname: '/compose', params: { date: selectedDate } });
        else router.push('/compose');
      }} onQuickCompose={() => router.push({ pathname: '/compose', params: { quick: '1' } })} />
      <EntryActionModal visible={Boolean(actionEntry)} onClose={() => setActionEntry(null)} onEdit={() => { if (!actionEntry) return; const entryId = actionEntry.id; setActionEntry(null); router.push({ pathname: '/compose', params: { id: entryId } }); }} onDelete={deleteSelectedEntry} />
    </SafeAreaView>
  );
}

type FilterKind = EntryFilterKind;
type ActiveFilterKind = Exclude<FilterKind, 'none'>;
const PAGE_SIZE = 30;
const EMPTY_FILTER_OPTIONS: EntryFilterOptions = { locations: [], tags: [], moods: [], weather: [] };

function Timeline({ refreshKey, entryRefresh, scrollRequest, onOpen, onLongPress }: { refreshKey: number; entryRefresh: { id: string; revision: number } | null; scrollRequest: number; onOpen: (entry: Entry) => void; onLongPress: (entry: Entry) => void }) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { readingTheme } = useAppPreferences();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<EntryPageCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const requestId = useRef(0);
  const listRef = useRef<SectionList<Entry>>(null);
  const initialLoadStartedAt = useRef(startupTimer());
  const [filterOptions, setFilterOptions] = useState<EntryFilterOptions>(EMPTY_FILTER_OPTIONS);
  const [filterKind, setFilterKind] = useState<FilterKind>('none');
  const [filters, setFilters] = useState<EntryListFilters>({});
  const [filterPickerVisible, setFilterPickerVisible] = useState(false);
  const [timeIndexVisible, setTimeIndexVisible] = useState(false);
  const [monthIndex, setMonthIndex] = useState<EntryMonthIndexItem[]>([]);
  const [pickerYear, setTimelinePickerYear] = useState(new Date().getFullYear());
  const [pickerMonth, setTimelinePickerMonth] = useState(new Date().getMonth() + 1);
  const [pickerDay, setTimelinePickerDay] = useState(new Date().getDate());
  const [pickerDayCount, setPickerDayCount] = useState<number | null>(null);
  const pickerYearRef = useRef(pickerYear);
  const pickerMonthRef = useRef(pickerMonth);
  const pickerDayRef = useRef(pickerDay);
  const [visibleMonth, setVisibleMonth] = useState(() => monthKey(new Date().toISOString()));
  const [jumpStartCursor, setJumpStartCursor] = useState<EntryPageCursor | null>(null);
  const [newerCursor, setNewerCursor] = useState<EntryPageCursor | null>(null);
  const [hasNewer, setHasNewer] = useState(false);
  const [historyMode, setHistoryMode] = useState(false);
  const [highlightedEntryId, setHighlightedEntryId] = useState<string | null>(null);
  const [jumpNotice, setJumpNotice] = useState<string | null>(null);
  const pendingJumpRef = useRef(false);
  const visibleEntryIdRef = useRef<string | null>(null);
  const visibleEntryDateRef = useRef<string | null>(null);
  const restoreEntryIdRef = useRef<string | null>(null);
  const filterButtonRef = useRef<View>(null);
  const [filterAnchor, setFilterAnchor] = useState<{ x: number; y: number; width: number; height: number }>({ x: spacing.xl, y: 0, width: 96, height: 36 });
  const availableTags = filterOptions.tags;
  const availableLocations = filterOptions.locations;
  const availableMoods = filterOptions.moods;
  const availableWeather = filterOptions.weather;
  const filterLabels: Record<FilterKind, string> = { none: '全部记录', time: '时间', location: '地点', tag: '标签', mood: '心情', weather: '天气' };
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const loadFirstPage = useCallback(async () => {
    const currentRequest = ++requestId.current;
    try {
      const [page, options] = await Promise.all([
        listEntryPage(db, { limit: PAGE_SIZE, filters, cursor: jumpStartCursor }),
        listEntryFilterOptions(db),
      ]);
      if (currentRequest !== requestId.current) return;
      setLoadError(false);
      setEntries(page.entries);
      setCursor(page.nextCursor);
      setHasMore(Boolean(page.nextCursor));
      setFilterOptions(options);
      if (jumpStartCursor) {
        const first = page.entries[0];
        setNewerCursor(first ? entryCursor(first) : jumpStartCursor);
        setHasNewer(Boolean(first));
      } else {
        setNewerCursor(null);
        setHasNewer(false);
      }
      if (pendingJumpRef.current && page.entries[0]) {
        pendingJumpRef.current = false;
        setHighlightedEntryId(page.entries[0].id);
        setTimeout(() => setHighlightedEntryId(null), 600);
        requestAnimationFrame(() => listRef.current?.scrollToLocation({ sectionIndex: 0, itemIndex: 0, animated: false, viewOffset: 0 }));
      }
      finishStartupMetric('home', initialLoadStartedAt.current);
    } catch (error) {
      void recordAppError('timeline.load', error);
      if (currentRequest === requestId.current) setLoadError(true);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [db, filters, jumpStartCursor]);

  useEffect(() => {
    if (refreshKey <= 0) return;
    const timer = setTimeout(() => void loadFirstPage(), 0);
    return () => clearTimeout(timer);
  }, [loadFirstPage, refreshKey]);

  useEffect(() => {
    if (!entryRefresh) return;
    let active = true;
    void getEntry(db, entryRefresh.id).then((updated) => {
      if (!active) return;
      setEntries((current) => {
        const existingIndex = current.findIndex((item) => item.id === entryRefresh.id);
        if (existingIndex < 0) return current;
        if (!updated) return current.filter((item) => item.id !== entryRefresh.id);
        const next = [...current];
        next[existingIndex] = updated;
        next.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
        return next;
      });
    }).catch(() => { /* Keep the existing card when a detail refresh fails. */ });
    return () => { active = false; };
  }, [db, entryRefresh]);

  const loadMore = useCallback(async () => {
    if (!hasMore || !cursor || loading || loadingMore) return;
    const currentRequest = requestId.current;
    setLoadingMore(true);
    try {
      const page = await listEntryPage(db, {
        limit: PAGE_SIZE,
        cursor,
        filters,
      });
      if (currentRequest !== requestId.current) return;
      setEntries((current) => [...current, ...page.entries.filter((item) => !current.some((entry) => entry.id === item.id))]);
      setCursor(page.nextCursor);
      setHasMore(Boolean(page.nextCursor));
    } finally {
      if (currentRequest === requestId.current) setLoadingMore(false);
    }
  }, [cursor, db, filters, hasMore, loading, loadingMore]);

  const loadNewer = useCallback(async () => {
    if (!hasNewer || !newerCursor || loading || loadingNewer) return;
    const currentRequest = requestId.current;
    setLoadingNewer(true);
    try {
      const page = await listNewerEntryPage(db, { limit: PAGE_SIZE, cursor: newerCursor, filters });
      if (currentRequest !== requestId.current) return;
      setEntries((current) => [...page.entries.filter((item) => !current.some((entry) => entry.id === item.id)), ...current]);
      const first = page.entries[0];
      setNewerCursor(page.nextCursor ?? (first ? entryCursor(first) : newerCursor));
      setHasNewer(Boolean(page.nextCursor));
    } finally { if (currentRequest === requestId.current) setLoadingNewer(false); }
  }, [db, filters, hasNewer, loading, loadingNewer, newerCursor]);

  const groups = useMemo(() => {
    const result: { label: string; weekday: string; data: Entry[] }[] = [];
    for (const entry of entries) {
      const label = groupLabel(entry.occurredAt);
      const previous = result.at(-1);
      if (previous?.label === label) previous.data.push(entry);
      else result.push({ label, weekday: weekdayLabel(entry.occurredAt), data: [entry] });
    }
    return result;
  }, [entries]);

  const years = useMemo(() => [...new Set(monthIndex.map((item) => Number(item.key.slice(0, 4))))].sort((left, right) => left - right), [monthIndex]);
  const pickerMonths = useMemo(() => Array.from({ length: 12 }, (_, index) => index + 1), []);
  const pickerDays = useMemo(() => Array.from({ length: daysInMonth(pickerYear, pickerMonth) }, (_, index) => index + 1), [pickerMonth, pickerYear]);
  const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 20 }), []);
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: { item: Entry }[] }) => {
    const first = viewableItems.find((item) => item.item?.occurredAt)?.item;
    if (first) { visibleEntryIdRef.current = first.id; visibleEntryDateRef.current = first.occurredAt; setVisibleMonth(monthKey(first.occurredAt)); }
  }, []);

  useEffect(() => {
    if (!timeIndexVisible) return;
    let active = true;
    void countEntriesForLocalDate(db, pickerYear, pickerMonth, pickerDay, filters)
      .then((count) => { if (active) setPickerDayCount(count); })
      .catch(() => { if (active) setPickerDayCount(0); });
    return () => { active = false; };
  }, [db, filters, pickerDay, pickerMonth, pickerYear, timeIndexVisible]);

  const openTimelineEntry = useCallback((entry: Entry) => {
    restoreEntryIdRef.current = visibleEntryIdRef.current ?? entry.id;
    onOpen(entry);
  }, [onOpen]);

  useEffect(() => {
    if (!entryRefresh || !restoreEntryIdRef.current) return;
    const id = restoreEntryIdRef.current;
    const sectionIndex = groups.findIndex((section) => section.data.some((entry) => entry.id === id));
    if (sectionIndex < 0) return;
    const itemIndex = groups[sectionIndex].data.findIndex((entry) => entry.id === id);
    requestAnimationFrame(() => listRef.current?.scrollToLocation({ sectionIndex, itemIndex, animated: false, viewOffset: 0 }));
  }, [entryRefresh, groups]);

  async function openTimeIndex(initialDate?: string) {
    try {
      const items = await listEntryMonthIndex(db, filters);
      setMonthIndex(items);
      const visibleDate = new Date(initialDate ?? visibleEntryDateRef.current ?? `${visibleMonth}-01T12:00:00`);
      const availableYears = [...new Set(items.map((item) => Number(item.key.slice(0, 4))))];
      const year = availableYears.includes(visibleDate.getFullYear()) ? visibleDate.getFullYear() : availableYears[0] ?? new Date().getFullYear();
      setTimelinePickerYear(year);
      setTimelinePickerMonth(visibleDate.getMonth() + 1);
      setTimelinePickerDay(Math.min(visibleDate.getDate(), daysInMonth(year, visibleDate.getMonth() + 1)));
      pickerYearRef.current = year;
      pickerMonthRef.current = visibleDate.getMonth() + 1;
      pickerDayRef.current = Math.min(visibleDate.getDate(), daysInMonth(year, visibleDate.getMonth() + 1));
      setPickerDayCount(null);
      setTimeIndexVisible(true);
    } catch {
      await showAppDialog({ title: '时间索引暂时不可用', message: '时间轴内容没有受到影响，请稍后重试。' });
    }
  }

  async function jumpToTimelineDate(year?: number, month?: number, day?: number) {
    const selectedYear = year ?? pickerYearRef.current;
    const selectedMonth = month ?? pickerMonthRef.current;
    const selectedDay = Math.min(day ?? pickerDayRef.current, daysInMonth(selectedYear, selectedMonth));
    const requestedBoundary = new Date(selectedYear, selectedMonth - 1, selectedDay + 1).toISOString();
    const target = await findTimelineJumpTarget(db, requestedBoundary, filters);
    if (!target) { setTimeIndexVisible(false); return; }
    const targetDate = new Date(target.occurredAt);
    const boundary = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() + 1).toISOString();
    setVisibleMonth(monthKey(target.occurredAt));
    setJumpStartCursor({ occurredAt: boundary, createdAt: boundary, id: '\uffff' });
    setHistoryMode(true);
    pendingJumpRef.current = true;
    setTimeIndexVisible(false);
    setLoading(true);
    if (!target.exact) {
      setJumpNotice('当天没有记录，已定位到附近记录');
      setTimeout(() => setJumpNotice(null), 1800);
    }
  }

  function selectTimelinePickerYear(year: number) {
    if (pickerYearRef.current !== year) setPickerDayCount(null);
    pickerYearRef.current = year;
    setTimelinePickerYear(year);
    const day = Math.min(pickerDayRef.current, daysInMonth(year, pickerMonthRef.current));
    pickerDayRef.current = day;
    setTimelinePickerDay(day);
  }

  function selectTimelinePickerMonth(month: number) {
    if (pickerMonthRef.current !== month) setPickerDayCount(null);
    pickerMonthRef.current = month;
    setTimelinePickerMonth(month);
    const day = Math.min(pickerDayRef.current, daysInMonth(pickerYearRef.current, month));
    pickerDayRef.current = day;
    setTimelinePickerDay(day);
  }

  function selectTimelinePickerDay(day: number) { if (pickerDayRef.current !== day) setPickerDayCount(null); pickerDayRef.current = day; setTimelinePickerDay(day); }

  function jumpToToday() {
    setVisibleMonth(monthKey(new Date().toISOString()));
    setJumpStartCursor(null);
    setHistoryMode(false);
    setTimeIndexVisible(false);
    if (jumpStartCursor) setLoading(true);
    else requestAnimationFrame(() => listRef.current?.scrollToLocation({ sectionIndex: 0, itemIndex: 0, animated: true, viewOffset: 0 }));
  }

  useEffect(() => {
    if (!scrollRequest || !groups.length) return;
    listRef.current?.scrollToLocation({ sectionIndex: 0, itemIndex: 0, animated: true, viewOffset: 0 });
  }, [groups.length, scrollRequest]);

  if (loading && !entries.length) return <ActivityIndicator style={styles.loader} color={colors.primary} />;
  if (loadError && !entries.length) return <View style={styles.loadFailure}><Text style={[styles.loadFailureTitle, { color: readingTheme.text }]}>时间轴暂时没有加载出来</Text><Text style={[styles.loadFailureText, { color: readingTheme.secondary }]}>记录仍保存在本机，可以重新读取。</Text><Pressable onPress={() => void loadFirstPage()} style={styles.retryButton}><Text style={styles.retryButtonText}>重新读取</Text></Pressable></View>;
  const valueOptions = filterKind === 'time'
    ? [{ value: 'today', label: '今天' }, { value: '7days', label: '最近 7 天' }, { value: '30days', label: '最近 30 天' }, { value: 'year', label: '今年' }]
    : filterKind === 'location' ? availableLocations.map((value) => ({ value, label: `⌖ ${value}` }))
      : filterKind === 'tag' ? availableTags.map((value) => ({ value, label: `#${value}` }))
        : filterKind === 'mood' ? availableMoods.map((value) => ({ value, label: value }))
          : filterKind === 'weather' ? availableWeather.map((value) => ({ value, label: value })) : [];

  function chooseFilterKind(kind: FilterKind) {
    if (kind === 'none') {
      setFilters({});
      setFilterKind('none');
    } else setFilterKind(kind);
    setFilterPickerVisible(false);
  }

  function setFilterValue(value: string | null) {
    if (filterKind === 'none') return;
    setFilters((current) => {
      const next = { ...current };
      if (value) next[filterKind] = value;
      else delete next[filterKind];
      return next;
    });
  }

  function openFilterPicker() {
    filterButtonRef.current?.measureInWindow((x, y, width, height) => {
      setFilterAnchor({ x, y, width, height });
      setFilterPickerVisible(true);
    });
  }

  return <View style={styles.timelineContainer}>
    {loadError && entries.length ? <Pressable onPress={() => void loadFirstPage()} style={styles.refreshFailure}><Text style={styles.refreshFailureText}>暂时无法刷新，正在显示上次内容　重试</Text></Pressable> : null}
    {jumpNotice ? <View pointerEvents="none" style={styles.timelineNotice}><Text style={styles.timelineNoticeText}>{jumpNotice}</Text></View> : null}
    <View style={styles.timelineTools}><ScrollView horizontal style={styles.filterBarScroll} contentContainerStyle={styles.filterBar} showsHorizontalScrollIndicator={false}>
        <Pressable ref={filterButtonRef} accessibilityLabel="选择筛选方式" onPress={openFilterPicker} style={[styles.filterMenuButton, { backgroundColor: readingTheme.surface }]}><Text style={styles.filterMenuText}>{activeFilterCount ? `${activeFilterCount} 项筛选` : filterLabels[filterKind]}</Text><View style={[styles.filterChevron, filterPickerVisible && styles.filterChevronOpen]} /></Pressable>
        {filterKind !== 'none' ? <><Pressable onPress={() => setFilterValue(null)} style={[styles.filterChip, { backgroundColor: readingTheme.surface }, !filters[filterKind] && styles.filterChipActive]}><Text style={[styles.filterText, { color: readingTheme.secondary }, !filters[filterKind] && styles.filterTextActive]}>不限{filterLabels[filterKind]}</Text></Pressable>{valueOptions.map((option) => <Pressable key={option.value} onPress={() => setFilterValue(option.value)} style={[styles.filterChip, { backgroundColor: readingTheme.surface }, filters[filterKind] === option.value && styles.filterChipActive]}><Text numberOfLines={1} style={[styles.filterText, { color: readingTheme.secondary }, filters[filterKind] === option.value && styles.filterTextActive]}>{option.label}</Text></Pressable>)}</> : null}
        {activeFilterCount ? Object.entries(filters).map(([kind, value]) => value ? <Pressable key={kind} accessibilityLabel={`清除${filterLabels[kind as ActiveFilterKind]}筛选`} onPress={() => setFilters((current) => { const next = { ...current }; delete next[kind as ActiveFilterKind]; return next; })} style={[styles.activeFilterChip, { backgroundColor: readingTheme.surface }]}><Text numberOfLines={1} style={styles.activeFilterText}>{filterLabels[kind as ActiveFilterKind]} · {value}　×</Text></Pressable> : null) : null}
        {activeFilterCount ? <Pressable accessibilityLabel="清除全部筛选" hitSlop={8} onPress={() => { setFilters({}); setFilterKind('none'); }}><Text style={[styles.clearFilter, { color: readingTheme.secondary }]}>清除全部</Text></Pressable> : null}
      </ScrollView><Pressable accessibilityLabel="打开回忆" onPress={() => router.push('/memories' as Href)} style={[styles.memoryShortcut, { backgroundColor: readingTheme.surface }]}><Text style={styles.memoryShortcutText}>✦ 回忆</Text></Pressable></View>
    <SectionList
      ref={listRef}
      sections={groups}
      keyExtractor={(entry) => entry.id}
      renderSectionHeader={({ section }) => <Pressable accessibilityLabel={`${section.label}，${section.weekday}，点击选择其他日期`} accessibilityRole="button" onPress={() => void openTimeIndex(section.data[0]?.occurredAt)} style={({ pressed }) => [styles.dayHeader, { backgroundColor: readingTheme.background }, pressed && styles.dayHeaderPressed]}><Text style={[styles.dayTitle, { color: readingTheme.text }]}>{section.label}</Text><Text style={[styles.weekday, { color: readingTheme.secondary }]}>{section.weekday}</Text></Pressable>}
      renderItem={({ item }) => <EntryCard entry={item} highlighted={item.id === highlightedEntryId} onPress={() => openTimelineEntry(item)} onLongPress={() => onLongPress(item)} />}
      ListEmptyComponent={<EmptyState title={!activeFilterCount ? '从此刻开始' : '没有相关记录'} description={!activeFilterCount ? '写下第一条记录，把日子慢慢收好。' : '减少一个筛选条件试试。'} />}
      contentContainerStyle={styles.timeline}
      showsVerticalScrollIndicator={false}
      stickySectionHeadersEnabled={false}
      initialNumToRender={8}
      maxToRenderPerBatch={6}
      updateCellsBatchingPeriod={50}
      windowSize={7}
      removeClippedSubviews={Platform.OS === 'android'}
      onEndReached={() => { void loadMore(); }}
      onEndReachedThreshold={0.6}
      refreshing={loadingNewer}
      onRefresh={() => { if (hasNewer) void loadNewer(); }}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.pageLoader} color={colors.primary} /> : null}
    />
    {historyMode ? <Pressable accessibilityLabel="回到最新记录" onPress={jumpToToday} style={[styles.backToLatest, { backgroundColor: readingTheme.surface }]}><Text style={styles.backToLatestText}>↑ 回到最新</Text></Pressable> : null}
    <Modal visible={filterPickerVisible} transparent animationType="fade" onRequestClose={() => setFilterPickerVisible(false)}>
      <Pressable onPress={() => setFilterPickerVisible(false)} style={styles.filterOverlay}><Pressable onPress={(event) => event.stopPropagation()} style={[styles.filterPicker, { backgroundColor: readingTheme.background, left: filterAnchor.x, top: filterAnchor.y + filterAnchor.height + 2, width: filterAnchor.width }]}>
        <View style={styles.filterKinds}>
          {([['none', '清除全部'], ['time', '时间'], ['location', '地点'], ['tag', '标签'], ['mood', '心情'], ['weather', '天气']] as [FilterKind, string][]).map(([kind, title]) => <Pressable accessibilityRole="menuitem" key={kind} onPress={() => chooseFilterKind(kind)} style={({ pressed }) => [styles.filterKind, pressed && { backgroundColor: readingTheme.surface }]}><Text numberOfLines={1} style={[styles.filterKindTitle, { color: kind === filterKind ? colors.primary : readingTheme.text }]}>{title}</Text>{kind !== 'none' && filters[kind] ? <Text style={styles.filterCheck}>✓</Text> : null}</Pressable>)}
        </View>
      </Pressable></Pressable>
    </Modal>
    <Modal visible={timeIndexVisible} transparent animationType="fade" onRequestClose={() => setTimeIndexVisible(false)}>
      <Pressable accessibilityLabel="关闭时间索引" onPress={() => setTimeIndexVisible(false)} style={styles.timeIndexOverlay}>
        <Pressable onPress={(event) => event.stopPropagation()} style={[styles.timeIndexSheet, { backgroundColor: readingTheme.background, height: 324 + insets.bottom, paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={[styles.timeIndexHeader, { borderBottomColor: readingTheme.border }]}><Pressable hitSlop={12} onPress={() => setTimeIndexVisible(false)}><Text style={[styles.timeIndexHeaderAction, { color: readingTheme.secondary }]}>取消</Text></Pressable><Text style={[styles.timeIndexTitle, { color: readingTheme.text }]}>选择日期</Text><Pressable hitSlop={12} onPress={() => void jumpToTimelineDate()}><Text style={styles.timeIndexHeaderAction}>确定</Text></Pressable></View>
          <View style={styles.timeWheel}><View pointerEvents="none" style={[styles.timeWheelSelection, { borderColor: readingTheme.border }]} /><NumberWheelColumn values={years} selected={pickerYear} suffix="年" onPreview={(value) => { pickerYearRef.current = value; }} onSelect={selectTimelinePickerYear} /><NumberWheelColumn values={pickerMonths} selected={pickerMonth} suffix="月" onPreview={(value) => { pickerMonthRef.current = value; }} onSelect={selectTimelinePickerMonth} /><NumberWheelColumn values={pickerDays} selected={pickerDay} suffix="日" onPreview={(value) => { pickerDayRef.current = value; }} onSelect={selectTimelinePickerDay} /></View>
          <Text style={[styles.timeIndexSummary, { color: readingTheme.secondary }]}>{pickerDayCount === null ? '正在统计当天记录…' : pickerDayCount > 0 ? `当天有 ${pickerDayCount} 条记录` : '当天没有记录'}</Text>
          <View style={styles.timeIndexActions}><Pressable disabled={!monthIndex.length} onPress={() => { const earliest = monthIndex.at(-1); if (!earliest) return; const [year, month] = earliest.key.split('-').map(Number); void jumpToTimelineDate(year, month, 1); }}><Text style={[styles.timeIndexAction, !monthIndex.length && styles.timeIndexActionDisabled]}>最早记录</Text></Pressable><Pressable onPress={jumpToToday}><Text style={styles.timeIndexAction}>今天</Text></Pressable></View>
        </Pressable>
      </Pressable>
    </Modal>
  </View>;
}

function monthKey(iso: string) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function entryCursor(entry: Entry): EntryPageCursor {
  return { occurredAt: entry.occurredAt, createdAt: entry.createdAt, id: entry.id };
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function CalendarViewComponent({ refreshKey, entryRefresh, selected, onSelect, onOpen, onLongPress }: { refreshKey: number; entryRefresh: { id: string; revision: number } | null; selected: string; onSelect: (date: string) => void; onOpen: (entry: Entry) => void; onLongPress: (entry: Entry) => void }) {
  const db = useSQLiteContext();
  const { readingTheme } = useAppPreferences();
  const now = useMemo(() => new Date(), []);
  const [monthOffset, setMonthOffset] = useState(0);
  const [calendarWidth, setCalendarWidth] = useState(0);
  const [calendarOrder, setCalendarOrder] = useState<'asc' | 'desc'>('asc');
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  const [pickerYear, setPickerYear] = useState(now.getFullYear());
  const monthPickerYearsRef = useRef<ScrollView>(null);
  const [monthCounts, setMonthCounts] = useState<Record<string, number>>({});
  const [selectedEntries, setSelectedEntries] = useState<Entry[]>([]);
  const [loadedDate, setLoadedDate] = useState<string | null>(null);
  const [monthLoadError, setMonthLoadError] = useState(false);
  const [dateLoadError, setDateLoadError] = useState(false);
  const [calendarRetry, setCalendarRetry] = useState(0);
  const [monthTransition] = useState(() => new Animated.Value(1));
  const [monthDirection, setMonthDirection] = useState(1);
  const monthTransitionReady = useRef(false);
  useEffect(() => { void getCalendarOrder(db).then(setCalendarOrder); }, [db]);
  const month = useMemo(() => new Date(now.getFullYear(), now.getMonth() + monthOffset, 1), [monthOffset, now]);
  const year = month.getFullYear(); const monthIndex = month.getMonth();
  useEffect(() => {
    if (!monthTransitionReady.current) { monthTransitionReady.current = true; return; }
    monthTransition.stopAnimation();
    monthTransition.setValue(0);
    Animated.timing(monthTransition, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [monthOffset, monthTransition]);
  useEffect(() => {
    if (refreshKey === 0) return;
    const start = new Date(year, monthIndex, 1);
    const end = new Date(year, monthIndex + 1, 1);
    void listCalendarMonthCounts(db, start.toISOString(), end.toISOString()).then((counts) => { setMonthCounts(counts); setMonthLoadError(false); }).catch(() => setMonthLoadError(true));
  }, [calendarRetry, db, monthIndex, refreshKey, year]);
  useEffect(() => {
    if (refreshKey === 0) return;
    let active = true;
    void listEntriesForDate(db, selected).then((items) => {
      if (active) {
        setSelectedEntries(items);
        setLoadedDate(selected);
        setDateLoadError(false);
      }
    }).catch(() => { if (active) setDateLoadError(true); });
    return () => { active = false; };
  }, [calendarRetry, db, refreshKey, selected]);
  useEffect(() => {
    if (!entryRefresh) return;
    let active = true;
    void getEntry(db, entryRefresh.id).then((updated) => {
      if (!active) return;
      setSelectedEntries((current) => {
        if (!current.some((item) => item.id === entryRefresh.id)) return current;
        return updated && dateKey(updated.occurredAt) === selected
          ? current.map((item) => item.id === entryRefresh.id ? updated : item)
          : current.filter((item) => item.id !== entryRefresh.id);
      });
    }).catch(() => { /* Keep the existing card when a detail refresh fails. */ });
    return () => { active = false; };
  }, [db, entryRefresh, selected]);
  const cells = useMemo(() => {
    const firstWeekday = (month.getDay() + 6) % 7;
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    return Array.from({ length: cellCount }, (_, index) => {
      const day = index - firstWeekday + 1;
      if (day < 1 || day > daysInMonth) return null;
      const key = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return { day, key, lunar: lunarDayLabel(year, monthIndex + 1, day) };
    });
  }, [month, monthIndex, year]);
  const orderedSelectedEntries = useMemo(
    () => [...selectedEntries].sort((a, b) => calendarOrder === 'asc' ? a.occurredAt.localeCompare(b.occurredAt) : b.occurredAt.localeCompare(a.occurredAt)),
    [calendarOrder, selectedEntries],
  );
  const dateLoading = loadedDate !== selected;
  const awayFromToday = monthOffset !== 0 || selected !== dateKey(now.toISOString());

  const changeMonth = useCallback((delta: number) => {
    setMonthDirection(delta < 0 ? -1 : 1);
    const nextOffset = monthOffset + delta;
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + nextOffset, 1);
    setMonthOffset(nextOffset);
    onSelect(`${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`);
  }, [monthOffset, now, onSelect]);

  function jumpToMonth(targetYear: number, targetMonth: number) {
    setMonthDirection((targetYear - year) * 12 + targetMonth - monthIndex < 0 ? -1 : 1);
    setMonthOffset((targetYear - now.getFullYear()) * 12 + targetMonth - now.getMonth());
    onSelect(`${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-01`);
    setMonthPickerVisible(false);
  }

  function toggleCalendarOrder() {
    const next = calendarOrder === 'asc' ? 'desc' : 'asc';
    setCalendarOrder(next);
    void saveCalendarOrder(db, next).catch(() => setCalendarOrder(calendarOrder));
  }

  const monthSwipeResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => (
      Math.abs(gesture.dx) > 12
      && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.35
    ),
    onPanResponderRelease: (_, gesture) => {
      const intentionalSwipe = Math.abs(gesture.dx) >= 48 || (Math.abs(gesture.vx) >= 0.45 && Math.abs(gesture.dx) >= 24);
      if (intentionalSwipe) changeMonth(gesture.dx < 0 ? 1 : -1);
    },
    onPanResponderTerminationRequest: () => true,
  }), [changeMonth]);

  const cellSize = Math.floor(calendarWidth / 7);
  const monthTransitionStyle = {
    opacity: monthTransition.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }),
    transform: [{ translateX: monthTransition.interpolate({ inputRange: [0, 1], outputRange: [monthDirection * 16, 0] }) }],
  };

  const calendarHeader = <><View style={styles.monthHeader}>
      <Pressable accessibilityLabel="上个月" onPress={() => changeMonth(-1)} style={[styles.monthButton, { backgroundColor: readingTheme.surface }]}><View style={[styles.monthArrow, styles.monthArrowLeft, { borderColor: readingTheme.text }]} /></Pressable>
      <View style={styles.monthCenter}><Pressable accessibilityLabel={`选择年月，当前 ${year} 年 ${monthIndex + 1} 月`} onPress={() => { setPickerYear(year); setMonthPickerVisible(true); }} style={styles.monthTitleButton}><Text style={[styles.monthTitle, { color: readingTheme.text }]}>{year} 年 {monthIndex + 1} 月</Text></Pressable>{awayFromToday ? <Pressable accessibilityLabel="回到今天" onPress={() => { setMonthOffset(0); onSelect(dateKey(now.toISOString())); }} style={[styles.todayButton, { backgroundColor: readingTheme.surface }]}><Text style={styles.todayText}>今天</Text></Pressable> : null}</View>
      <Pressable accessibilityLabel="下个月" onPress={() => changeMonth(1)} style={[styles.monthButton, { backgroundColor: readingTheme.surface }]}><View style={[styles.monthArrow, styles.monthArrowRight, { borderColor: readingTheme.text }]} /></Pressable>
    </View>
    {monthLoadError ? <Pressable onPress={() => setCalendarRetry((value) => value + 1)} style={styles.calendarFailure}><Text style={styles.calendarFailureText}>月份标记暂时无法刷新　重试</Text></Pressable> : null}
    <Animated.View accessibilityLabel="日历，可左右滑动切换月份" {...monthSwipeResponder.panHandlers} style={[styles.calendarBoard, monthTransitionStyle]} onLayout={(event) => setCalendarWidth(event.nativeEvent.layout.width)}>
      {cellSize > 0 ? <>
        <View style={[styles.weekRow, { width: cellSize * 7 }]}>{['一','二','三','四','五','六','日'].map((item) => <Text allowFontScaling={false} key={item} style={[styles.weekLabel, { width: cellSize, color: readingTheme.secondary }]}>{item}</Text>)}</View>
        <View style={[styles.grid, { width: cellSize * 7 }]}>{cells.map((cell, index) => {
          if (!cell) return <View key={`empty-${index}`} style={[styles.dayCell, { width: cellSize, height: cellSize }]} />;
          const count = monthCounts[cell.key] ?? 0; const active = selected === cell.key;
          return <Pressable key={cell.key} onPress={() => onSelect(cell.key)} style={[styles.dayCell, { width: cellSize, height: cellSize }]}>
            <View style={[styles.dayCellInner, active ? { backgroundColor: colors.primary, borderRadius: 20, overflow: 'hidden' } : null]}><Text allowFontScaling={false} style={[styles.dayNumber, { color: readingTheme.text }, active && styles.dayNumberActive]}>{cell.day}</Text><Text allowFontScaling={false} style={[styles.lunarDay, { color: readingTheme.secondary }, active && styles.lunarDayActive]}>{cell.lunar}</Text>{count > 0 ? <View style={[styles.dayDot, active && styles.dayDotActive]} /> : null}</View>
          </Pressable>;
        })}</View>
      </> : null}
    </Animated.View>
    <View style={[styles.selectedHeader, { borderTopColor: readingTheme.border }]}> 
      <Text style={[styles.selectedCount, { color: readingTheme.secondary }]}>{dateLoading ? '读取中…' : `${orderedSelectedEntries.length} 条记录`}</Text>
      {orderedSelectedEntries.length > 1 ? <Pressable accessibilityLabel={`当前${calendarOrder === 'asc' ? '正序' : '倒序'}，点击切换`} hitSlop={8} onPress={toggleCalendarOrder} style={[styles.calendarOrderButton, { backgroundColor: readingTheme.surface }]}><Text style={styles.calendarOrderText}>{calendarOrder === 'asc' ? '正序' : '倒序'}</Text><View style={styles.calendarOrderChevron} /></Pressable> : null}
    </View>{dateLoadError ? <Pressable onPress={() => setCalendarRetry((value) => value + 1)} style={styles.calendarFailure}><Text style={styles.calendarFailureText}>这一天暂时没有加载出来，正在保留上次内容　重试</Text></Pressable> : null}</>;

  return <><FlatList
    data={orderedSelectedEntries}
    keyExtractor={(entry) => entry.id}
    renderItem={({ item }) => <EntryCard entry={item} onPress={() => onOpen(item)} onLongPress={() => onLongPress(item)} />}
    ListHeaderComponent={calendarHeader}
    ListEmptyComponent={dateLoading && !dateLoadError ? <ActivityIndicator style={styles.pageLoader} color={colors.primary} /> : dateLoadError ? null : <EmptyState title="这一天还没有记录" description="可以修改日期，补记发生过的事情。" />}
    contentContainerStyle={styles.calendar}
    showsVerticalScrollIndicator={false}
    initialNumToRender={5}
    maxToRenderPerBatch={4}
    windowSize={5}
    removeClippedSubviews={Platform.OS === 'android'}
  /><Modal visible={monthPickerVisible} transparent animationType="fade" onRequestClose={() => setMonthPickerVisible(false)} onShow={() => { const index = pickerYear - (now.getFullYear() - 50); requestAnimationFrame(() => monthPickerYearsRef.current?.scrollTo({ x: Math.max(0, index * 66), animated: false })); }}><Pressable accessibilityLabel="关闭年月选择" onPress={() => setMonthPickerVisible(false)} style={styles.monthPickerOverlay}><Pressable onPress={(event) => event.stopPropagation()} style={[styles.monthPicker, { backgroundColor: readingTheme.background }]}><Text style={[styles.monthPickerTitle, { color: readingTheme.text }]}>跳转到年月</Text><ScrollView ref={monthPickerYearsRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.monthPickerYears}>{Array.from({ length: 51 }, (_, index) => now.getFullYear() - 50 + index).map((itemYear) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: pickerYear === itemYear }} key={itemYear} onPress={() => setPickerYear(itemYear)} style={[styles.monthPickerYear, { backgroundColor: readingTheme.surface }, pickerYear === itemYear && styles.monthPickerYearActive]}><Text style={[styles.monthPickerYearText, { color: readingTheme.secondary }, pickerYear === itemYear && styles.monthPickerYearTextActive]}>{itemYear}</Text></Pressable>)}</ScrollView><View style={styles.monthPickerGrid}>{Array.from({ length: 12 }, (_, index) => <Pressable accessibilityLabel={`${pickerYear} 年 ${index + 1} 月`} key={index} onPress={() => jumpToMonth(pickerYear, index)} style={[styles.monthPickerMonth, { backgroundColor: readingTheme.surface }, pickerYear === year && index === monthIndex && styles.monthPickerMonthActive]}><Text style={[styles.monthPickerMonthText, { color: readingTheme.text }, pickerYear === year && index === monthIndex && styles.monthPickerMonthTextActive]}>{index + 1} 月</Text></Pressable>)}</View><View style={styles.monthPickerActions}><Pressable onPress={() => { setMonthOffset(0); onSelect(dateKey(now.toISOString())); setMonthPickerVisible(false); }}><Text style={styles.monthPickerToday}>回到今天</Text></Pressable><Pressable onPress={() => setMonthPickerVisible(false)}><Text style={[styles.monthPickerCancel, { color: readingTheme.secondary }]}>取消</Text></Pressable></View></Pressable></Pressable></Modal></>;
}

const CalendarView = memo(CalendarViewComponent);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingTop: spacing.xs, paddingBottom: spacing.xs },
  headerIdentity: { flex: 1, minWidth: 0, marginRight: spacing.md, paddingBottom: 2 },
  brand: { color: colors.text, fontFamily: fonts.serif, fontSize: 24, lineHeight: 29, fontWeight: '600', includeFontPadding: false },
  subtitle: { marginTop: 5, color: colors.textSecondary, fontFamily: fonts.sans, fontSize: 11, lineHeight: 14, letterSpacing: 0.4, includeFontPadding: false },
  headerActions: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  searchButton: { width: 32, height: 32, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  draftDot: { position: 'absolute', top: 5, right: 5, width: 6, height: 6, borderRadius: 3, backgroundColor: '#C06C58' },
  profileButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.primary },
  profileImage: { width: 36, height: 36, borderRadius: 18 },
  profileText: { width: 32, height: 32, color: '#FFFFFF', fontFamily: fonts.serif, fontSize: 14, fontWeight: '600', lineHeight: 32, textAlign: 'center', includeFontPadding: false },
  content: { flex: 1 }, viewPane: { ...StyleSheet.absoluteFill }, hiddenPane: { opacity: 0 }, loader: { marginTop: 80 }, pageLoader: { marginVertical: spacing.lg },
  loadFailure: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxxl }, loadFailureTitle: { fontFamily: fonts.serif, fontSize: 18 }, loadFailureText: { marginTop: spacing.sm, fontSize: 12, textAlign: 'center' }, retryButton: { marginTop: spacing.xl, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.primary }, retryButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' }, refreshFailure: { alignItems: 'center', paddingVertical: spacing.xs, backgroundColor: colors.primarySoft }, refreshFailureText: { color: colors.primary, fontSize: 10 },
  quickHint: { position: 'absolute', left: spacing.xl, right: spacing.xl, bottom: 86, zIndex: 30, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, borderRadius: radii.md, elevation: 4, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }, quickHintText: { fontSize: 11 }, quickHintClose: { marginLeft: spacing.md, color: colors.primary, fontSize: 11, fontWeight: '700' },
  timelineContainer: { flex: 1 }, timeline: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  backToLatest: { position: 'absolute', zIndex: 15, right: spacing.xl, bottom: spacing.lg, minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radii.pill, elevation: 4, shadowColor: '#000000', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }, backToLatestText: { color: colors.primary, fontSize: 10, fontWeight: '700' },
  timelineNotice: { position: 'absolute', zIndex: 20, top: 46, alignSelf: 'center', paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: '#25302CEB' }, timelineNoticeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '600' },
  timelineTools: { height: 44, flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.xl, paddingRight: spacing.xl, gap: spacing.sm }, filterBarScroll: { flex: 1, flexGrow: 1 }, filterBar: { alignItems: 'center', gap: spacing.sm }, memoryShortcut: { flexShrink: 0, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: colors.primarySoft }, memoryShortcutText: { color: colors.primary, fontSize: 10, lineHeight: 14, fontWeight: '700' }, filterMenuButton: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted }, filterMenuText: { color: colors.primary, fontSize: 10, lineHeight: 14, fontWeight: '600' }, filterChevron: { width: 6, height: 6, marginTop: -2, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: colors.primary, transform: [{ rotate: '45deg' }] }, filterChevronOpen: { marginTop: 3, transform: [{ rotate: '-135deg' }] }, clearFilter: { paddingHorizontal: spacing.xs, color: colors.textFaint, fontSize: 10 },
  filterChip: { maxWidth: 190, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted }, filterChipActive: { backgroundColor: colors.primary },
  filterText: { color: colors.textSecondary, fontSize: 10 }, filterTextActive: { color: '#FFFFFF' },
  activeFilterChip: { maxWidth: 190, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.pill }, activeFilterText: { color: colors.primary, fontSize: 10, fontWeight: '600' },
  filterOverlay: { flex: 1, backgroundColor: '#00000014' }, filterPicker: { position: 'absolute', overflow: 'hidden', borderRadius: radii.md, backgroundColor: colors.background, elevation: 8, shadowColor: '#000000', shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } }, filterKinds: { paddingVertical: spacing.xs }, filterKind: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md }, filterKindTitle: { flexShrink: 1, color: colors.text, fontSize: 10, fontWeight: '600' }, filterCheck: { marginLeft: spacing.xs, color: colors.primary, fontSize: 12, fontWeight: '700' },
  timeIndexOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay }, timeIndexSheet: { height: 324, paddingBottom: spacing.lg, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg }, timeIndexHeader: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth }, timeIndexTitle: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '700' }, timeIndexHeaderAction: { minWidth: 44, color: colors.primary, fontSize: 14, fontWeight: '600' }, timeWheel: { height: 176, overflow: 'hidden', flexDirection: 'row', marginTop: spacing.md, paddingHorizontal: spacing.lg }, timeWheelSelection: { position: 'absolute', left: spacing.lg, right: spacing.lg, top: 66, height: NUMBER_WHEEL_ITEM_HEIGHT, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth }, timeIndexSummary: { marginTop: spacing.md, fontSize: 10, lineHeight: 14, textAlign: 'center' }, timeIndexActions: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs, paddingHorizontal: spacing.xxl }, timeIndexAction: { color: colors.primary, fontSize: 12, fontWeight: '700' }, timeIndexActionDisabled: { opacity: 0.35 },
  dayHeader: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: -spacing.xs, paddingHorizontal: spacing.xs, paddingTop: 3, paddingBottom: 3, borderRadius: radii.sm }, dayHeaderPressed: { opacity: 0.58 },
  dayTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 16, lineHeight: 23, fontWeight: '600', includeFontPadding: false },
  weekday: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 9, lineHeight: 14, includeFontPadding: false },
  calendar: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxxl },
  monthHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  monthButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.surfaceMuted },
  monthArrow: { width: 9, height: 9, borderLeftWidth: 2, borderBottomWidth: 2, borderColor: colors.text },
  monthArrowLeft: { transform: [{ rotate: '45deg' }] },
  monthArrowRight: { transform: [{ rotate: '225deg' }] },
  monthCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, monthTitleButton: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 }, monthTitle: { fontFamily: fonts.serif, fontSize: 18, lineHeight: 28, fontWeight: '600', includeFontPadding: false },
  todayButton: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: colors.primarySoft }, todayText: { color: colors.primary, fontSize: 9, fontWeight: '700' },
  calendarBoard: { width: '100%', alignItems: 'center' },
  weekRow: { flexDirection: 'row', marginTop: spacing.xs }, weekLabel: { color: colors.textFaint, fontFamily: fonts.sans, textAlign: 'center', fontSize: 11 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { alignItems: 'center', justifyContent: 'center' }, dayCellInner: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, overflow: 'hidden' },
  dayNumber: { color: colors.text, fontFamily: fonts.sans, fontSize: 13, lineHeight: 17 }, dayNumberActive: { color: '#FFFFFF' },
  lunarDay: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 8, lineHeight: 11 }, lunarDayActive: { color: '#E8F0EB' },
  dayDot: { position: 'absolute', bottom: 1, alignSelf: 'center', width: 4, height: 4, borderRadius: 2, backgroundColor: colors.primary }, dayDotActive: { backgroundColor: '#FFFFFF' },
  selectedHeader: { minHeight: 34, marginTop: spacing.xs, paddingTop: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  selectedCount: { color: colors.textSecondary, fontFamily: fonts.sans, fontSize: 10, lineHeight: 16, includeFontPadding: false },
  calendarFailure: { alignItems: 'center', marginVertical: spacing.xs, paddingVertical: spacing.sm, borderRadius: radii.md, backgroundColor: colors.primarySoft }, calendarFailureText: { color: colors.primary, fontSize: 10 },
  calendarOrderButton: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted },
  calendarOrderText: { color: colors.primary, fontSize: 10, lineHeight: 14 },
  calendarOrderChevron: { width: 5, height: 5, marginTop: -2, borderRightWidth: 1.25, borderBottomWidth: 1.25, borderColor: colors.primary, transform: [{ rotate: '45deg' }] },
  monthPickerOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.overlay }, monthPicker: { width: '100%', maxWidth: 340, padding: spacing.xl, borderRadius: radii.lg }, monthPickerTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '600', textAlign: 'center' }, monthPickerYears: { gap: spacing.xs, paddingVertical: spacing.lg }, monthPickerYear: { minWidth: 58, minHeight: 34, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.pill }, monthPickerYearActive: { backgroundColor: colors.primary }, monthPickerYearText: { fontSize: 11 }, monthPickerYearTextActive: { color: '#FFFFFF', fontWeight: '700' }, monthPickerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, monthPickerMonth: { width: '22%', minHeight: 42, flexGrow: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md }, monthPickerMonthActive: { backgroundColor: colors.primary }, monthPickerMonthText: { fontSize: 12 }, monthPickerMonthTextActive: { color: '#FFFFFF', fontWeight: '700' }, monthPickerActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xl, paddingHorizontal: spacing.sm }, monthPickerToday: { color: colors.primary, fontSize: 12, fontWeight: '700' }, monthPickerCancel: { fontSize: 12 },
});
