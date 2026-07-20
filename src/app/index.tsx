import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { BottomNavigation, type HomeView } from '@/components/bottom-navigation';
import { EmptyState } from '@/components/empty-state';
import { EntryCard } from '@/components/entry-card';
import { cleanupExpiredTrash, listEntries } from '@/database/journal-repository';
import type { Entry } from '@/domain/journal';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { dateKey, groupLabel, weekdayLabel } from '@/utils/date';
import { lunarDayLabel } from '@/utils/lunar';
import { deleteJournalImage } from '@/utils/image-storage';

export default function HomeScreen() {
  const db = useSQLiteContext();
  const todayKey = dateKey(new Date().toISOString());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<HomeView>('timeline');
  const [selectedDate, setSelectedDate] = useState(todayKey);

  const load = useCallback(async () => {
    try {
      const expiredImages = await cleanupExpiredTrash(db);
      expiredImages.forEach(deleteJournalImage);
      setEntries(await listEntries(db));
    } finally { setLoading(false); }
  }, [db]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.header}>
        <View><Text style={styles.brand}>拾时</Text><Text style={styles.subtitle}>{view === 'timeline' ? '我的日迹' : '日历回看'}</Text></View>
        <View style={styles.headerActions}>
          <Pressable accessibilityLabel="搜索" onPress={() => router.push('/search')} style={styles.searchButton}><Text style={styles.searchIcon}>⌕</Text></Pressable>
          <Pressable accessibilityLabel="我的" onPress={() => router.push('/settings')} style={styles.profileButton}><Text style={styles.profileText}>时</Text></Pressable>
        </View>
      </View>

      <View style={styles.content}>
        {loading ? <ActivityIndicator style={styles.loader} color={colors.primary} /> : view === 'timeline' ? (
          <Timeline entries={entries} />
        ) : <CalendarView entries={entries} selected={selectedDate} onSelect={setSelectedDate} />}
      </View>

      <BottomNavigation view={view} onChange={setView} onCompose={() => {
        if (view === 'calendar') router.push({ pathname: '/compose', params: { date: selectedDate } });
        else router.push('/compose');
      }} />
    </SafeAreaView>
  );
}

function Timeline({ entries }: { entries: Entry[] }) {
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const availableTags = useMemo(() => {
    const counts = new Map<string, number>();
    entries.forEach((entry) => entry.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN')).map(([tag]) => tag);
  }, [entries]);
  const visibleEntries = useMemo(
    () => activeTag ? entries.filter((entry) => entry.tags.includes(activeTag)) : entries,
    [activeTag, entries],
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
  return <View style={styles.timelineContainer}>
    {availableTags.length ? <ScrollView horizontal style={styles.tagFilterScroll} contentContainerStyle={styles.tagFilters} showsHorizontalScrollIndicator={false}>
      <Pressable onPress={() => setActiveTag(null)} style={[styles.filterChip, !activeTag && styles.filterChipActive]}><Text style={[styles.filterText, !activeTag && styles.filterTextActive]}>全部</Text></Pressable>
      {availableTags.map((tag) => <Pressable key={tag} onPress={() => setActiveTag(tag)} style={[styles.filterChip, activeTag === tag && styles.filterChipActive]}><Text style={[styles.filterText, activeTag === tag && styles.filterTextActive]}>#{tag}</Text></Pressable>)}
    </ScrollView> : null}
    <ScrollView contentContainerStyle={styles.timeline} showsVerticalScrollIndicator={false}>
      {groups.map((group) => <View key={group.label}>
        <View style={styles.dayHeader}><Text style={styles.dayTitle}>{group.label}</Text><Text style={styles.weekday}>{group.weekday}</Text></View>
        {group.entries.map((entry) => <EntryCard key={entry.id} entry={entry} onPress={() => router.push({ pathname: '/entry/[id]', params: { id: entry.id } })} />)}
      </View>)}
      {!visibleEntries.length ? <EmptyState title="没有相关记录" description={`还没有添加 #${activeTag} 的记录。`} /> : null}
    </ScrollView>
  </View>;
}

function CalendarView({ entries, selected, onSelect }: { entries: Entry[]; selected: string; onSelect: (date: string) => void }) {
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

  const cellSize = Math.floor(calendarWidth / 7);

  return <ScrollView contentContainerStyle={styles.calendar} showsVerticalScrollIndicator={false}>
    <View style={styles.monthHeader}>
      <Pressable accessibilityLabel="上个月" onPress={() => setMonthOffset((value) => value - 1)} style={styles.monthButton}><View style={[styles.monthArrow, styles.monthArrowLeft]} /></Pressable>
      <View style={styles.monthCenter}><Text style={styles.monthTitle}>{year} 年 {monthIndex + 1} 月</Text>{awayFromToday ? <Pressable onPress={() => { setMonthOffset(0); onSelect(dateKey(now.toISOString())); }} style={styles.todayButton}><Text style={styles.todayText}>今天</Text></Pressable> : null}</View>
      <Pressable accessibilityLabel="下个月" onPress={() => setMonthOffset((value) => value + 1)} style={styles.monthButton}><View style={[styles.monthArrow, styles.monthArrowRight]} /></Pressable>
    </View>
    <View style={styles.calendarBoard} onLayout={(event) => setCalendarWidth(event.nativeEvent.layout.width)}>
      {cellSize > 0 ? <>
        <View style={[styles.weekRow, { width: cellSize * 7 }]}>{['一','二','三','四','五','六','日'].map((item) => <Text allowFontScaling={false} key={item} style={[styles.weekLabel, { width: cellSize }]}>{item}</Text>)}</View>
        <View style={[styles.grid, { width: cellSize * 7 }]}>{cells.map((day, index) => {
          if (!day) return <View key={`empty-${index}`} style={[styles.dayCell, { width: cellSize, height: cellSize }]} />;
          const key = keyForDay(day); const count = counts.get(key) ?? 0; const active = selected === key;
          return <Pressable key={key} onPress={() => onSelect(key)} style={[styles.dayCell, { width: cellSize, height: cellSize }, active && styles.dayCellActive]}>
            <Text allowFontScaling={false} style={[styles.dayNumber, active && styles.dayNumberActive]}>{day}</Text>
            <Text allowFontScaling={false} style={[styles.lunarDay, active && styles.lunarDayActive]}>{lunarDayLabel(year, monthIndex + 1, day)}</Text>
            {count > 0 ? <View style={[styles.dayDot, active && styles.dayDotActive]} /> : null}
          </Pressable>;
        })}</View>
      </> : null}
    </View>
    <View style={styles.selectedHeader}><Text style={styles.selectedCount}>{selectedEntries.length} 条记录</Text></View>
    {selectedEntries.length ? selectedEntries.map((entry) => <EntryCard key={entry.id} entry={entry} onPress={() => router.push({ pathname: '/entry/[id]', params: { id: entry.id } })} />) : <EmptyState title="这一天还没有记录" description="可以修改日期，补记发生过的事情。" />}
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
  profileText: { color: '#FFFFFF', fontFamily: fonts.serif, fontSize: 14, fontWeight: '600' },
  content: { flex: 1 }, loader: { marginTop: 80 },
  timelineContainer: { flex: 1 }, timeline: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  tagFilterScroll: { flexGrow: 0, height: 38 }, tagFilters: { alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl },
  filterChip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted }, filterChipActive: { backgroundColor: colors.primary },
  filterText: { color: colors.textSecondary, fontSize: 10 }, filterTextActive: { color: '#FFFFFF' },
  dayHeader: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.sm, backgroundColor: colors.background },
  dayTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 19, lineHeight: 28, fontWeight: '600', includeFontPadding: false },
  weekday: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 11, lineHeight: 18, includeFontPadding: false },
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
  dayCell: { alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill },
  dayCellActive: { backgroundColor: colors.primary }, dayNumber: { color: colors.text, fontFamily: fonts.sans, fontSize: 13, lineHeight: 17 }, dayNumberActive: { color: '#FFFFFF' },
  lunarDay: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 8, lineHeight: 11 }, lunarDayActive: { color: '#E8F0EB' },
  dayDot: { position: 'absolute', bottom: 2, width: 4, height: 4, borderRadius: 2, backgroundColor: colors.primary }, dayDotActive: { backgroundColor: '#FFFFFF' },
  selectedHeader: { marginTop: spacing.xs, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  selectedCount: { color: colors.textSecondary, fontFamily: fonts.sans, fontSize: 10, lineHeight: 16, includeFontPadding: false },
});
