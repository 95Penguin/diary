import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { BottomNavigation, type HomeView } from '@/components/bottom-navigation';
import { EmptyState } from '@/components/empty-state';
import { EntryCard } from '@/components/entry-card';
import { EntryActionModal } from '@/components/entry-action-modal';
import { cleanupExpiredTrash, deleteEntry, listEntries } from '@/database/journal-repository';
import type { Entry } from '@/domain/journal';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { dateKey, groupLabel, weekdayLabel } from '@/utils/date';
import { lunarDayLabel } from '@/utils/lunar';
import { deleteJournalImage } from '@/utils/image-storage';
import { useAppPreferences } from '@/preferences/app-preferences';

export default function HomeScreen() {
  const db = useSQLiteContext();
  const { preferences, readingTheme } = useAppPreferences();
  const todayKey = dateKey(new Date().toISOString());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<HomeView>('timeline');
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [actionEntry, setActionEntry] = useState<Entry | null>(null);

  const load = useCallback(async () => {
    try {
      const expiredImages = await cleanupExpiredTrash(db);
      expiredImages.forEach(deleteJournalImage);
      setEntries(await listEntries(db));
    } finally { setLoading(false); }
  }, [db]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function openEntryActions(entry: Entry) {
    setActionEntry(entry);
  }

  async function deleteSelectedEntry() {
    if (!actionEntry) return;
    try {
      await deleteEntry(db, actionEntry.id);
      setEntries((current) => current.filter((item) => item.id !== actionEntry.id));
      setActionEntry(null);
    } catch { Alert.alert('删除失败', '记录暂时无法删除，请稍后重试。'); }
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: readingTheme.background }]}>
      <View style={styles.header}>
        <View><Text style={[styles.brand, { color: readingTheme.text }]}>拾时</Text><Text style={[styles.subtitle, { color: readingTheme.secondary }]}>{view === 'timeline' ? '我的日迹' : '日历回看'}</Text></View>
        <View style={styles.headerActions}>
          <Pressable accessibilityLabel="草稿箱" onPress={() => router.push('/drafts' as Href)} style={[styles.searchButton, { backgroundColor: readingTheme.surface }]}><SymbolView name={{ ios: 'doc.text', android: 'draft', web: 'draft' }} size={18} tintColor={colors.primary} /></Pressable>
          <Pressable accessibilityLabel="收藏列表" onPress={() => router.push('/favorites' as Href)} style={[styles.searchButton, { backgroundColor: readingTheme.surface }]}><SymbolView name={{ ios: 'bookmark', android: 'bookmark', web: 'bookmark' }} size={19} tintColor={colors.primary} /></Pressable>
          <Pressable accessibilityLabel="搜索" onPress={() => router.push('/search')} style={[styles.searchButton, { backgroundColor: readingTheme.surface }]}><Text style={[styles.searchIcon, { color: readingTheme.text }]}>⌕</Text></Pressable>
          <Pressable accessibilityLabel={`我的，${preferences.nickname}`} onPress={() => router.push('/settings')} style={styles.profileButton}>{preferences.avatarUri ? <Image source={preferences.avatarUri} contentFit="cover" style={styles.profileImage} /> : <Text style={styles.profileText}>{preferences.nickname.slice(0, 1)}</Text>}</Pressable>
        </View>
      </View>

      <View style={styles.content}>
        {loading ? <ActivityIndicator style={styles.loader} color={colors.primary} /> : view === 'timeline' ? (
          <Timeline entries={entries} onLongPress={openEntryActions} />
        ) : <CalendarView entries={entries} selected={selectedDate} onSelect={setSelectedDate} onLongPress={openEntryActions} />}
      </View>

      <BottomNavigation view={view} onChange={setView} onCompose={() => {
        if (view === 'calendar') router.push({ pathname: '/compose', params: { date: selectedDate } });
        else router.push('/compose');
      }} />
      <EntryActionModal visible={Boolean(actionEntry)} onClose={() => setActionEntry(null)} onEdit={() => { if (!actionEntry) return; const entryId = actionEntry.id; setActionEntry(null); router.push({ pathname: '/compose', params: { id: entryId } }); }} onDelete={deleteSelectedEntry} />
    </SafeAreaView>
  );
}

type FilterKind = 'none' | 'time' | 'location' | 'tag' | 'mood' | 'weather';

function Timeline({ entries, onLongPress }: { entries: Entry[]; onLongPress: (entry: Entry) => void }) {
  const { readingTheme } = useAppPreferences();
  const [filterKind, setFilterKind] = useState<FilterKind>('none');
  const [filterValue, setFilterValue] = useState<string | null>(null);
  const [filterPickerVisible, setFilterPickerVisible] = useState(false);
  const availableTags = useMemo(() => {
    const counts = new Map<string, number>();
    entries.forEach((entry) => entry.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN')).map(([tag]) => tag);
  }, [entries]);
  const availableLocations = useMemo(() => [...new Set(entries.map((entry) => entry.locationName).filter((item): item is string => Boolean(item)))].sort((a, b) => a.localeCompare(b, 'zh-CN')), [entries]);
  const availableMoods = useMemo(() => [...new Set(entries.map((entry) => entry.mood).filter((item): item is string => Boolean(item)))], [entries]);
  const availableWeather = useMemo(() => [...new Set(entries.map((entry) => entry.weather).filter((item): item is string => Boolean(item)))], [entries]);
  const filterLabels: Record<FilterKind, string> = { none: '全部记录', time: '时间', location: '地点', tag: '标签', mood: '心情', weather: '天气' };
  const visibleEntries = useMemo(
    () => entries.filter((entry) => {
      if (!filterValue || filterKind === 'none') return true;
      if (filterKind === 'location') return entry.locationName === filterValue;
      if (filterKind === 'tag') return entry.tags.includes(filterValue);
      if (filterKind === 'mood') return entry.mood === filterValue;
      if (filterKind === 'weather') return entry.weather === filterValue;
      const occurred = new Date(entry.occurredAt); const now = new Date();
      if (filterValue === 'today') return dateKey(entry.occurredAt) === dateKey(now.toISOString());
      if (filterValue === '7days') return occurred.getTime() >= now.getTime() - 7 * 24 * 60 * 60 * 1000;
      if (filterValue === '30days') return occurred.getTime() >= now.getTime() - 30 * 24 * 60 * 60 * 1000;
      if (filterValue === 'year') return occurred.getFullYear() === now.getFullYear();
      return true;
    }),
    [entries, filterKind, filterValue],
  );
  const groups = useMemo(() => {
    const result: { label: string; weekday: string; entries: Entry[] }[] = [];
    for (const entry of visibleEntries) {
      const label = groupLabel(entry.occurredAt);
      const previous = result.at(-1);
      if (previous?.label === label) previous.entries.push(entry);
      else result.push({ label, weekday: weekdayLabel(entry.occurredAt), entries: [entry] });
    }
    return result;
  }, [visibleEntries]);

  if (!entries.length) return <EmptyState title="从此刻开始" description="写下第一条记录，把日子慢慢收好。" />;
  const valueOptions = filterKind === 'time'
    ? [{ value: 'today', label: '今天' }, { value: '7days', label: '最近 7 天' }, { value: '30days', label: '最近 30 天' }, { value: 'year', label: '今年' }]
    : filterKind === 'location' ? availableLocations.map((value) => ({ value, label: `⌖ ${value}` }))
      : filterKind === 'tag' ? availableTags.map((value) => ({ value, label: `#${value}` }))
        : filterKind === 'mood' ? availableMoods.map((value) => ({ value, label: value }))
          : filterKind === 'weather' ? availableWeather.map((value) => ({ value, label: value })) : [];

  function chooseFilterKind(kind: FilterKind) {
    setFilterKind(kind); setFilterValue(null); setFilterPickerVisible(false);
  }

  return <View style={styles.timelineContainer}>
    <View style={styles.timelineTools}><ScrollView horizontal style={styles.filterBarScroll} contentContainerStyle={styles.filterBar} showsHorizontalScrollIndicator={false}>
        <Pressable accessibilityLabel="选择筛选方式" onPress={() => setFilterPickerVisible(true)} style={[styles.filterMenuButton, { backgroundColor: readingTheme.surface }, filterKind !== 'none' && styles.filterMenuButtonActive]}><Text style={[styles.filterMenuText, { color: readingTheme.secondary }, filterKind !== 'none' && styles.filterMenuTextActive]}>{filterLabels[filterKind]}</Text><View style={[styles.filterChevron, { borderColor: filterKind !== 'none' ? colors.primary : readingTheme.secondary }]} /></Pressable>
        {filterKind !== 'none' ? <><Pressable onPress={() => setFilterValue(null)} style={[styles.filterChip, { backgroundColor: readingTheme.surface }, !filterValue && styles.filterChipActive]}><Text style={[styles.filterText, { color: readingTheme.secondary }, !filterValue && styles.filterTextActive]}>全部</Text></Pressable>{valueOptions.map((option) => <Pressable key={option.value} onPress={() => setFilterValue(option.value)} style={[styles.filterChip, { backgroundColor: readingTheme.surface }, filterValue === option.value && styles.filterChipActive]}><Text numberOfLines={1} style={[styles.filterText, { color: readingTheme.secondary }, filterValue === option.value && styles.filterTextActive]}>{option.label}</Text></Pressable>)}<Pressable accessibilityLabel="清除筛选" hitSlop={8} onPress={() => { setFilterKind('none'); setFilterValue(null); }}><Text style={[styles.clearFilter, { color: readingTheme.secondary }]}>清除</Text></Pressable></> : null}
      </ScrollView><Pressable accessibilityLabel="打开拾起一刻" onPress={() => router.push('/memories' as Href)} style={[styles.memoryShortcut, { backgroundColor: readingTheme.surface }]}><Text style={styles.memoryShortcutText}>✦ 回忆</Text></Pressable></View>
    <ScrollView contentContainerStyle={styles.timeline} showsVerticalScrollIndicator={false}>
      {groups.map((group) => <View key={group.label}>
        <View style={[styles.dayHeader, { backgroundColor: readingTheme.background }]}><Text style={[styles.dayTitle, { color: readingTheme.text }]}>{group.label}</Text><Text style={[styles.weekday, { color: readingTheme.secondary }]}>{group.weekday}</Text></View>
        {group.entries.map((entry) => <EntryCard key={entry.id} entry={entry} onPress={() => router.push({ pathname: '/entry/[id]', params: { id: entry.id } })} onLongPress={() => onLongPress(entry)} />)}
      </View>)}
      {!visibleEntries.length ? <EmptyState title="没有相关记录" description="换一个筛选条件试试。" /> : null}
    </ScrollView>
    <Modal visible={filterPickerVisible} transparent animationType="fade" onRequestClose={() => setFilterPickerVisible(false)}>
      <Pressable onPress={() => setFilterPickerVisible(false)} style={styles.filterOverlay}><Pressable onPress={(event) => event.stopPropagation()} style={[styles.filterPicker, { backgroundColor: readingTheme.background }]}>
        <Text style={[styles.filterPickerTitle, { color: readingTheme.text }]}>选择筛选方式</Text>
        <View style={styles.filterKinds}>
          {([['none', '全部记录', '不限制筛选条件'], ['time', '时间', '今天、最近 7 天、最近 30 天或今年'], ['location', '地点', availableLocations.length ? `${availableLocations.length} 个地点` : '暂无地点记录'], ['tag', '标签', availableTags.length ? `${availableTags.length} 个标签` : '暂无标签记录'], ['mood', '心情', availableMoods.length ? `${availableMoods.length} 种心情` : '暂无心情记录'], ['weather', '天气', availableWeather.length ? `${availableWeather.length} 种天气` : '暂无天气记录']] as [FilterKind, string, string][]).map(([kind, title, description]) => <Pressable key={kind} onPress={() => chooseFilterKind(kind)} style={({ pressed }) => [styles.filterKind, { borderBottomColor: readingTheme.border }, pressed && { backgroundColor: readingTheme.surface }]}><View><Text style={[styles.filterKindTitle, { color: readingTheme.text }]}>{title}</Text><Text style={[styles.filterKindDescription, { color: readingTheme.secondary }]}>{description}</Text></View><Text style={styles.filterKindArrow}>›</Text></Pressable>)}
        </View>
        <Pressable onPress={() => setFilterPickerVisible(false)} style={styles.filterPickerCancel}><Text style={[styles.filterPickerCancelText, { color: readingTheme.secondary }]}>取消</Text></Pressable>
      </Pressable></Pressable>
    </Modal>
  </View>;
}

function CalendarView({ entries, selected, onSelect, onLongPress }: { entries: Entry[]; selected: string; onSelect: (date: string) => void; onLongPress: (entry: Entry) => void }) {
  const { readingTheme } = useAppPreferences();
  const now = new Date();
  const [monthOffset, setMonthOffset] = useState(0);
  const [calendarWidth, setCalendarWidth] = useState(0);
  const month = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const year = month.getFullYear(); const monthIndex = month.getMonth();
  const firstWeekday = (month.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const cells = Array.from({ length: cellCount }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day >= 1 && day <= daysInMonth ? day : null;
  });
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    entries.forEach((entry) => map.set(dateKey(entry.occurredAt), (map.get(dateKey(entry.occurredAt)) ?? 0) + 1));
    return map;
  }, [entries]);
  const selectedEntries = entries.filter((entry) => dateKey(entry.occurredAt) === selected);
  const awayFromToday = monthOffset !== 0 || selected !== dateKey(now.toISOString());

  function keyForDay(day: number) {
    return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function changeMonth(delta: number) {
    const nextOffset = monthOffset + delta;
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + nextOffset, 1);
    setMonthOffset(nextOffset);
    onSelect(`${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`);
  }

  const cellSize = Math.floor(calendarWidth / 7);

  return <ScrollView contentContainerStyle={styles.calendar} showsVerticalScrollIndicator={false}>
    <View style={styles.monthHeader}>
      <Pressable accessibilityLabel="上个月" onPress={() => changeMonth(-1)} style={[styles.monthButton, { backgroundColor: readingTheme.surface }]}><View style={[styles.monthArrow, styles.monthArrowLeft, { borderColor: readingTheme.text }]} /></Pressable>
      <View style={styles.monthCenter}><Text style={[styles.monthTitle, { color: readingTheme.text }]}>{year} 年 {monthIndex + 1} 月</Text>{awayFromToday ? <Pressable onPress={() => { setMonthOffset(0); onSelect(dateKey(now.toISOString())); }} style={[styles.todayButton, { backgroundColor: readingTheme.surface }]}><Text style={styles.todayText}>今天</Text></Pressable> : null}</View>
      <Pressable accessibilityLabel="下个月" onPress={() => changeMonth(1)} style={[styles.monthButton, { backgroundColor: readingTheme.surface }]}><View style={[styles.monthArrow, styles.monthArrowRight, { borderColor: readingTheme.text }]} /></Pressable>
    </View>
    <View style={styles.calendarBoard} onLayout={(event) => setCalendarWidth(event.nativeEvent.layout.width)}>
      {cellSize > 0 ? <>
        <View style={[styles.weekRow, { width: cellSize * 7 }]}>{['一','二','三','四','五','六','日'].map((item) => <Text allowFontScaling={false} key={item} style={[styles.weekLabel, { width: cellSize, color: readingTheme.secondary }]}>{item}</Text>)}</View>
        <View style={[styles.grid, { width: cellSize * 7 }]}>{cells.map((day, index) => {
          if (!day) return <View key={`empty-${index}`} style={[styles.dayCell, { width: cellSize, height: cellSize }]} />;
          const key = keyForDay(day); const count = counts.get(key) ?? 0; const active = selected === key;
          return <Pressable key={key} onPress={() => onSelect(key)} style={[styles.dayCell, { width: cellSize, height: cellSize }]}>
            <View style={[styles.dayCellInner, active && styles.dayCellActive, active && { width: 40, height: 40, borderRadius: 999, overflow: 'hidden' }]}><Text allowFontScaling={false} style={[styles.dayNumber, { color: readingTheme.text }, active && styles.dayNumberActive]}>{day}</Text><Text allowFontScaling={false} style={[styles.lunarDay, { color: readingTheme.secondary }, active && styles.lunarDayActive]}>{lunarDayLabel(year, monthIndex + 1, day)}</Text>{count > 0 ? <View style={[styles.dayDot, active && styles.dayDotActive]} /> : null}</View>
          </Pressable>;
        })}</View>
      </> : null}
    </View>
    <View style={[styles.selectedHeader, { borderTopColor: readingTheme.border }]}><Text style={[styles.selectedCount, { color: readingTheme.secondary }]}>{selectedEntries.length} 条记录</Text></View>
    {selectedEntries.length ? selectedEntries.map((entry) => <EntryCard key={entry.id} entry={entry} onPress={() => router.push({ pathname: '/entry/[id]', params: { id: entry.id } })} onLongPress={() => onLongPress(entry)} />) : <EmptyState title="这一天还没有记录" description="可以修改日期，补记发生过的事情。" />}
  </ScrollView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingTop: spacing.xs, paddingBottom: spacing.xs },
  brand: { color: colors.text, fontFamily: fonts.serif, fontSize: 24, lineHeight: 32, fontWeight: '600', includeFontPadding: false },
  subtitle: { color: colors.textSecondary, fontFamily: fonts.sans, fontSize: 10, lineHeight: 14, letterSpacing: 1, includeFontPadding: false },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  searchButton: { width: 36, height: 36, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  searchIcon: { color: colors.text, fontSize: 24, lineHeight: 36, marginTop: -3, includeFontPadding: false },
  profileButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.primary },
  profileImage: { width: 36, height: 36, borderRadius: 18 },
  profileText: { color: '#FFFFFF', fontFamily: fonts.serif, fontSize: 14, fontWeight: '600' },
  content: { flex: 1 }, loader: { marginTop: 80 },
  timelineContainer: { flex: 1 }, timeline: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  timelineTools: { height: 44, flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.xl, paddingRight: spacing.xl, gap: spacing.sm }, filterBarScroll: { flex: 1, flexGrow: 1 }, filterBar: { alignItems: 'center', gap: spacing.sm }, memoryShortcut: { flexShrink: 0, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: colors.primarySoft }, memoryShortcutText: { color: colors.primary, fontSize: 10, lineHeight: 14, fontWeight: '700' }, filterMenuButton: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted }, filterMenuButtonActive: { backgroundColor: colors.primarySoft }, filterMenuText: { color: colors.textSecondary, fontSize: 10, lineHeight: 14, fontWeight: '600' }, filterMenuTextActive: { color: colors.primary }, filterChevron: { width: 6, height: 6, borderRightWidth: 1.5, borderBottomWidth: 1.5, transform: [{ rotate: '45deg' }, { translateY: -1 }] }, clearFilter: { paddingHorizontal: spacing.xs, color: colors.textFaint, fontSize: 10 },
  filterChip: { maxWidth: 190, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted }, filterChipActive: { backgroundColor: colors.primary },
  filterText: { color: colors.textSecondary, fontSize: 10 }, filterTextActive: { color: '#FFFFFF' },
  filterOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.overlay }, filterPicker: { width: '100%', maxWidth: 320, padding: spacing.xl, borderRadius: radii.lg, backgroundColor: colors.background }, filterPickerTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 18, fontWeight: '600', textAlign: 'center' }, filterKinds: { marginTop: spacing.lg }, filterKind: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, filterKindPressed: { backgroundColor: colors.surfaceMuted }, filterKindTitle: { color: colors.text, fontSize: 12, fontWeight: '600' }, filterKindDescription: { marginTop: 2, color: colors.textFaint, fontSize: 9 }, filterKindArrow: { color: colors.primary, fontSize: 22 }, filterPickerCancel: { alignItems: 'center', paddingTop: spacing.lg }, filterPickerCancelText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  dayHeader: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, paddingTop: 3, paddingBottom: 3 },
  dayTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 16, lineHeight: 23, fontWeight: '600', includeFontPadding: false },
  weekday: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 9, lineHeight: 14, includeFontPadding: false },
  calendar: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxxl },
  monthHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  monthButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.surfaceMuted },
  monthArrow: { width: 9, height: 9, borderLeftWidth: 2, borderBottomWidth: 2, borderColor: colors.text },
  monthArrowLeft: { transform: [{ rotate: '45deg' }] },
  monthArrowRight: { transform: [{ rotate: '225deg' }] },
  monthCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, monthTitle: { fontFamily: fonts.serif, fontSize: 18, lineHeight: 28, fontWeight: '600', includeFontPadding: false },
  todayButton: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: colors.primarySoft }, todayText: { color: colors.primary, fontSize: 9, fontWeight: '700' },
  calendarBoard: { width: '100%', alignItems: 'center' },
  weekRow: { flexDirection: 'row', marginTop: spacing.xs }, weekLabel: { color: colors.textFaint, fontFamily: fonts.sans, textAlign: 'center', fontSize: 11 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { alignItems: 'center', justifyContent: 'center' }, dayCellInner: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  dayCellActive: { backgroundColor: colors.primary }, dayNumber: { color: colors.text, fontFamily: fonts.sans, fontSize: 13, lineHeight: 17 }, dayNumberActive: { color: '#FFFFFF' },
  lunarDay: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 8, lineHeight: 11 }, lunarDayActive: { color: '#E8F0EB' },
  dayDot: { position: 'absolute', bottom: 1, alignSelf: 'center', width: 4, height: 4, borderRadius: 2, backgroundColor: colors.primary }, dayDotActive: { backgroundColor: '#FFFFFF' },
  selectedHeader: { marginTop: spacing.xs, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  selectedCount: { color: colors.textSecondary, fontFamily: fonts.sans, fontSize: 10, lineHeight: 16, includeFontPadding: false },
});
