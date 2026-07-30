import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, InteractionManager, Modal, Platform, Pressable, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { BottomNavigation, type HomeView } from '@/components/bottom-navigation';
import { showAppDialog } from '@/components/app-dialog-host';
import { EmptyState } from '@/components/empty-state';
import { EntryCard } from '@/components/entry-card';
import { EntryActionModal } from '@/components/entry-action-modal';
import {
  cleanupExpiredTrash,
  deleteEntry,
  getDraftCount,
  getCalendarOrder,
  listCalendarMonthCounts,
  listEntriesForDate,
  listEntryFilterOptions,
  listEntryPage,
  listReferencedMediaUris,
  saveCalendarOrder,
  type EntryFilterKind,
  type EntryFilterOptions,
  type EntryListFilters,
  type EntryPageCursor,
} from '@/database/journal-repository';
import type { Entry } from '@/domain/journal';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { dateKey, groupLabel, weekdayLabel } from '@/utils/date';
import { lunarDayLabel } from '@/utils/lunar';
import { cleanupUnusedJournalMedia, deleteJournalImage } from '@/utils/image-storage';
import { useAppPreferences } from '@/preferences/app-preferences';
import { finishStartupMetric, startupTimer } from '@/utils/startup-performance';

export default function HomeScreen() {
  const db = useSQLiteContext();
  const { preferences, readingTheme } = useAppPreferences();
  const todayKey = dateKey(new Date().toISOString());
  const [refreshKey, setRefreshKey] = useState(0);
  const [view, setView] = useState<HomeView>('timeline');
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [actionEntry, setActionEntry] = useState<Entry | null>(null);
  const [draftCount, setDraftCount] = useState(0);
  const [quickHintVisible, setQuickHintVisible] = useState(false);
  const cleanupStarted = useRef(false);

  const refresh = useCallback(async () => {
    setRefreshKey((value) => value + 1);
    void getDraftCount(db).then(setDraftCount);
    if (!cleanupStarted.current) {
      cleanupStarted.current = true;
      InteractionManager.runAfterInteractions(() => {
        void cleanupExpiredTrash(db)
          .then((expiredImages) => expiredImages.forEach(deleteJournalImage))
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
        <View accessibilityElementsHidden={view !== 'timeline'} importantForAccessibility={view === 'timeline' ? 'auto' : 'no-hide-descendants'} pointerEvents={view === 'timeline' ? 'auto' : 'none'} style={[styles.viewPane, view !== 'timeline' && styles.hiddenPane]}><Timeline refreshKey={refreshKey} onLongPress={openEntryActions} /></View>
        <View accessibilityElementsHidden={view !== 'calendar'} importantForAccessibility={view === 'calendar' ? 'auto' : 'no-hide-descendants'} pointerEvents={view === 'calendar' ? 'auto' : 'none'} style={[styles.viewPane, view !== 'calendar' && styles.hiddenPane]}><CalendarView refreshKey={refreshKey} selected={selectedDate} onSelect={setSelectedDate} onLongPress={openEntryActions} /></View>
      </View>

      {quickHintVisible ? <Pressable accessibilityRole="button" accessibilityLabel="知道了" onPress={dismissQuickHint} style={[styles.quickHint, { backgroundColor: readingTheme.surface }]}><Text style={[styles.quickHintText, { color: readingTheme.secondary }]}>长按“＋”可以直接进入快速记录</Text><Text style={styles.quickHintClose}>知道了</Text></Pressable> : null}
      <BottomNavigation view={view} onChange={setView} onCompose={() => {
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

function Timeline({ refreshKey, onLongPress }: { refreshKey: number; onLongPress: (entry: Entry) => void }) {
  const db = useSQLiteContext();
  const { readingTheme } = useAppPreferences();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<EntryPageCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const requestId = useRef(0);
  const initialLoadStartedAt = useRef(startupTimer());
  const [filterOptions, setFilterOptions] = useState<EntryFilterOptions>(EMPTY_FILTER_OPTIONS);
  const [filterKind, setFilterKind] = useState<FilterKind>('none');
  const [filters, setFilters] = useState<EntryListFilters>({});
  const [filterPickerVisible, setFilterPickerVisible] = useState(false);
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
        listEntryPage(db, { limit: PAGE_SIZE, filters }),
        listEntryFilterOptions(db),
      ]);
      if (currentRequest !== requestId.current) return;
      setEntries(page.entries);
      setCursor(page.nextCursor);
      setHasMore(Boolean(page.nextCursor));
      setFilterOptions(options);
      finishStartupMetric('home', initialLoadStartedAt.current);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [db, filters]);

  useEffect(() => {
    if (refreshKey > 0) void loadFirstPage();
  }, [loadFirstPage, refreshKey]);

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

  if (loading && !entries.length) return <ActivityIndicator style={styles.loader} color={colors.primary} />;
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
    <View style={styles.timelineTools}><ScrollView horizontal style={styles.filterBarScroll} contentContainerStyle={styles.filterBar} showsHorizontalScrollIndicator={false}>
        <Pressable ref={filterButtonRef} accessibilityLabel="选择筛选方式" onPress={openFilterPicker} style={[styles.filterMenuButton, { backgroundColor: readingTheme.surface }]}><Text style={[styles.filterMenuText, { color: activeFilterCount ? colors.primary : readingTheme.secondary }]}>{activeFilterCount ? `${activeFilterCount} 项筛选` : filterLabels[filterKind]}</Text><View style={[styles.filterChevron, filterPickerVisible && styles.filterChevronOpen, { borderColor: activeFilterCount ? colors.primary : readingTheme.secondary }]} /></Pressable>
        {filterKind !== 'none' ? <><Pressable onPress={() => setFilterValue(null)} style={[styles.filterChip, { backgroundColor: readingTheme.surface }, !filters[filterKind] && styles.filterChipActive]}><Text style={[styles.filterText, { color: readingTheme.secondary }, !filters[filterKind] && styles.filterTextActive]}>不限{filterLabels[filterKind]}</Text></Pressable>{valueOptions.map((option) => <Pressable key={option.value} onPress={() => setFilterValue(option.value)} style={[styles.filterChip, { backgroundColor: readingTheme.surface }, filters[filterKind] === option.value && styles.filterChipActive]}><Text numberOfLines={1} style={[styles.filterText, { color: readingTheme.secondary }, filters[filterKind] === option.value && styles.filterTextActive]}>{option.label}</Text></Pressable>)}</> : null}
        {activeFilterCount ? Object.entries(filters).map(([kind, value]) => value ? <Pressable key={kind} accessibilityLabel={`清除${filterLabels[kind as ActiveFilterKind]}筛选`} onPress={() => setFilters((current) => { const next = { ...current }; delete next[kind as ActiveFilterKind]; return next; })} style={[styles.activeFilterChip, { backgroundColor: readingTheme.surface }]}><Text numberOfLines={1} style={styles.activeFilterText}>{filterLabels[kind as ActiveFilterKind]} · {value}　×</Text></Pressable> : null) : null}
        {activeFilterCount ? <Pressable accessibilityLabel="清除全部筛选" hitSlop={8} onPress={() => { setFilters({}); setFilterKind('none'); }}><Text style={[styles.clearFilter, { color: readingTheme.secondary }]}>清除全部</Text></Pressable> : null}
      </ScrollView><Pressable accessibilityLabel="打开回忆" onPress={() => router.push('/memories' as Href)} style={[styles.memoryShortcut, { backgroundColor: readingTheme.surface }]}><Text style={styles.memoryShortcutText}>✦ 回忆</Text></Pressable></View>
    <SectionList
      sections={groups}
      keyExtractor={(entry) => entry.id}
      renderSectionHeader={({ section }) => <View style={[styles.dayHeader, { backgroundColor: readingTheme.background }]}><Text style={[styles.dayTitle, { color: readingTheme.text }]}>{section.label}</Text><Text style={[styles.weekday, { color: readingTheme.secondary }]}>{section.weekday}</Text></View>}
      renderItem={({ item }) => <EntryCard entry={item} onPress={() => router.push({ pathname: '/entry/[id]', params: { id: item.id } })} onLongPress={() => onLongPress(item)} />}
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
      ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.pageLoader} color={colors.primary} /> : null}
    />
    <Modal visible={filterPickerVisible} transparent animationType="fade" onRequestClose={() => setFilterPickerVisible(false)}>
      <Pressable onPress={() => setFilterPickerVisible(false)} style={styles.filterOverlay}><Pressable onPress={(event) => event.stopPropagation()} style={[styles.filterPicker, { backgroundColor: readingTheme.background, left: filterAnchor.x, top: filterAnchor.y + filterAnchor.height + 2, width: filterAnchor.width }]}>
        <View style={styles.filterKinds}>
          {([['none', '清除全部'], ['time', '时间'], ['location', '地点'], ['tag', '标签'], ['mood', '心情'], ['weather', '天气']] as [FilterKind, string][]).map(([kind, title]) => <Pressable accessibilityRole="menuitem" key={kind} onPress={() => chooseFilterKind(kind)} style={({ pressed }) => [styles.filterKind, pressed && { backgroundColor: readingTheme.surface }]}><Text numberOfLines={1} style={[styles.filterKindTitle, { color: kind === filterKind ? colors.primary : readingTheme.text }]}>{title}</Text>{kind !== 'none' && filters[kind] ? <Text style={styles.filterCheck}>✓</Text> : null}</Pressable>)}
        </View>
      </Pressable></Pressable>
    </Modal>
  </View>;
}

function CalendarViewComponent({ refreshKey, selected, onSelect, onLongPress }: { refreshKey: number; selected: string; onSelect: (date: string) => void; onLongPress: (entry: Entry) => void }) {
  const db = useSQLiteContext();
  const { readingTheme } = useAppPreferences();
  const now = useMemo(() => new Date(), []);
  const [monthOffset, setMonthOffset] = useState(0);
  const [calendarWidth, setCalendarWidth] = useState(0);
  const [calendarOrder, setCalendarOrder] = useState<'asc' | 'desc'>('asc');
  const [monthCounts, setMonthCounts] = useState<Record<string, number>>({});
  const [selectedEntries, setSelectedEntries] = useState<Entry[]>([]);
  const [loadedDate, setLoadedDate] = useState<string | null>(null);
  useEffect(() => { void getCalendarOrder(db).then(setCalendarOrder); }, [db]);
  const month = useMemo(() => new Date(now.getFullYear(), now.getMonth() + monthOffset, 1), [monthOffset, now]);
  const year = month.getFullYear(); const monthIndex = month.getMonth();
  useEffect(() => {
    if (refreshKey === 0) return;
    const start = new Date(year, monthIndex, 1);
    const end = new Date(year, monthIndex + 1, 1);
    void listCalendarMonthCounts(db, start.toISOString(), end.toISOString()).then(setMonthCounts);
  }, [db, monthIndex, refreshKey, year]);
  useEffect(() => {
    if (refreshKey === 0) return;
    let active = true;
    void listEntriesForDate(db, selected).then((items) => {
      if (active) {
        setSelectedEntries(items);
        setLoadedDate(selected);
      }
    });
    return () => { active = false; };
  }, [db, refreshKey, selected]);
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

  function changeMonth(delta: number) {
    const nextOffset = monthOffset + delta;
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + nextOffset, 1);
    setMonthOffset(nextOffset);
    onSelect(`${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`);
  }

  function toggleCalendarOrder() {
    const next = calendarOrder === 'asc' ? 'desc' : 'asc';
    setCalendarOrder(next);
    void saveCalendarOrder(db, next).catch(() => setCalendarOrder(calendarOrder));
  }

  const cellSize = Math.floor(calendarWidth / 7);

  const calendarHeader = <><View style={styles.monthHeader}>
      <Pressable accessibilityLabel="上个月" onPress={() => changeMonth(-1)} style={[styles.monthButton, { backgroundColor: readingTheme.surface }]}><View style={[styles.monthArrow, styles.monthArrowLeft, { borderColor: readingTheme.text }]} /></Pressable>
      <View style={styles.monthCenter}><Text style={[styles.monthTitle, { color: readingTheme.text }]}>{year} 年 {monthIndex + 1} 月</Text>{awayFromToday ? <Pressable onPress={() => { setMonthOffset(0); onSelect(dateKey(now.toISOString())); }} style={[styles.todayButton, { backgroundColor: readingTheme.surface }]}><Text style={styles.todayText}>今天</Text></Pressable> : null}</View>
      <Pressable accessibilityLabel="下个月" onPress={() => changeMonth(1)} style={[styles.monthButton, { backgroundColor: readingTheme.surface }]}><View style={[styles.monthArrow, styles.monthArrowRight, { borderColor: readingTheme.text }]} /></Pressable>
    </View>
    <View style={styles.calendarBoard} onLayout={(event) => setCalendarWidth(event.nativeEvent.layout.width)}>
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
    </View>
    <View style={[styles.selectedHeader, { borderTopColor: readingTheme.border }]}>
      <Text style={[styles.selectedCount, { color: readingTheme.secondary }]}>{dateLoading ? '读取中…' : `${orderedSelectedEntries.length} 条记录`}</Text>
      {orderedSelectedEntries.length > 1 ? <Pressable accessibilityLabel={`当前${calendarOrder === 'asc' ? '正序' : '倒序'}，点击切换`} hitSlop={8} onPress={toggleCalendarOrder} style={[styles.calendarOrderButton, { backgroundColor: readingTheme.surface }]}><Text style={styles.calendarOrderText}>{calendarOrder === 'asc' ? '正序' : '倒序'}</Text><View style={styles.calendarOrderChevron} /></Pressable> : null}
    </View></>;

  return <FlatList
    data={orderedSelectedEntries}
    keyExtractor={(entry) => entry.id}
    renderItem={({ item }) => <EntryCard entry={item} onPress={() => router.push({ pathname: '/entry/[id]', params: { id: item.id } })} onLongPress={() => onLongPress(item)} />}
    ListHeaderComponent={calendarHeader}
    ListEmptyComponent={dateLoading ? <ActivityIndicator style={styles.pageLoader} color={colors.primary} /> : <EmptyState title="这一天还没有记录" description="可以修改日期，补记发生过的事情。" />}
    contentContainerStyle={styles.calendar}
    showsVerticalScrollIndicator={false}
    initialNumToRender={5}
    maxToRenderPerBatch={4}
    windowSize={5}
    removeClippedSubviews={Platform.OS === 'android'}
  />;
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
  profileText: { color: '#FFFFFF', fontFamily: fonts.serif, fontSize: 14, fontWeight: '600' },
  content: { flex: 1 }, viewPane: { ...StyleSheet.absoluteFill }, hiddenPane: { opacity: 0 }, loader: { marginTop: 80 }, pageLoader: { marginVertical: spacing.lg },
  quickHint: { position: 'absolute', left: spacing.xl, right: spacing.xl, bottom: 86, zIndex: 30, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, borderRadius: radii.md, elevation: 4, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }, quickHintText: { fontSize: 11 }, quickHintClose: { marginLeft: spacing.md, color: colors.primary, fontSize: 11, fontWeight: '700' },
  timelineContainer: { flex: 1 }, timeline: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  timelineTools: { height: 44, flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.xl, paddingRight: spacing.xl, gap: spacing.sm }, filterBarScroll: { flex: 1, flexGrow: 1 }, filterBar: { alignItems: 'center', gap: spacing.sm }, memoryShortcut: { flexShrink: 0, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: colors.primarySoft }, memoryShortcutText: { color: colors.primary, fontSize: 10, lineHeight: 14, fontWeight: '700' }, filterMenuButton: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted }, filterMenuText: { color: colors.textSecondary, fontSize: 10, lineHeight: 14, fontWeight: '600' }, filterChevron: { width: 6, height: 6, marginTop: -2, borderRightWidth: 1.5, borderBottomWidth: 1.5, transform: [{ rotate: '45deg' }] }, filterChevronOpen: { marginTop: 3, transform: [{ rotate: '-135deg' }] }, clearFilter: { paddingHorizontal: spacing.xs, color: colors.textFaint, fontSize: 10 },
  filterChip: { maxWidth: 190, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted }, filterChipActive: { backgroundColor: colors.primary },
  filterText: { color: colors.textSecondary, fontSize: 10 }, filterTextActive: { color: '#FFFFFF' },
  activeFilterChip: { maxWidth: 190, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.pill }, activeFilterText: { color: colors.primary, fontSize: 10, fontWeight: '600' },
  filterOverlay: { flex: 1, backgroundColor: '#00000014' }, filterPicker: { position: 'absolute', overflow: 'hidden', borderRadius: radii.md, backgroundColor: colors.background, elevation: 8, shadowColor: '#000000', shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } }, filterKinds: { paddingVertical: spacing.xs }, filterKind: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md }, filterKindTitle: { flexShrink: 1, color: colors.text, fontSize: 10, fontWeight: '600' }, filterCheck: { marginLeft: spacing.xs, color: colors.primary, fontSize: 12, fontWeight: '700' },
  dayHeader: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, paddingTop: 3, paddingBottom: 3 },
  dayTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 16, lineHeight: 23, fontWeight: '600', includeFontPadding: false },
  weekday: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 9, lineHeight: 14, includeFontPadding: false },
  calendar: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxxl },
  monthHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  monthButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.surfaceMuted },
  monthArrow: { width: 9, height: 9, borderLeftWidth: 2, borderBottomWidth: 2, borderColor: colors.text },
  monthArrowLeft: { transform: [{ rotate: '45deg' }] },
  monthArrowRight: { transform: [{ rotate: '225deg' }] },
  monthCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, monthTitle: { fontFamily: fonts.serif, fontSize: 18, lineHeight: 28, fontWeight: '600', includeFontPadding: false },
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
  calendarOrderButton: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted },
  calendarOrderText: { color: colors.primary, fontSize: 10, lineHeight: 14 },
  calendarOrderChevron: { width: 5, height: 5, marginTop: -2, borderRightWidth: 1.25, borderBottomWidth: 1.25, borderColor: colors.primary, transform: [{ rotate: '45deg' }] },
});
