import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { SymbolView } from 'expo-symbols';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listEntries, listSuppressedMemoryEntryIds, suppressMemoryEntry } from '@/database/journal-repository';
import type { Entry } from '@/domain/journal';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { useAppPreferences } from '@/preferences/app-preferences';
import { AppDialog } from '@/components/app-dialog';
import { showAppDialog } from '@/components/app-dialog-host';
import { MediaThumbnail } from '@/components/media-view';
import { pickRandomMemoryId } from '@/utils/memory-shuffle';

type MemoryMode = 'random' | 'today' | 'month' | 'yearWeek' | 'tag';
const modes: { value: MemoryMode; label: string }[] = [
  { value: 'random', label: '随缘拾起' }, { value: 'today', label: '那年今日' },
  { value: 'month', label: '一个月前' }, { value: 'yearWeek', label: '一年前本周' }, { value: 'tag', label: '按标签' },
];

function localDate(value: string) { return new Date(value); }
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function startOfDay(date: Date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function shiftedMonthDate(date: Date, offset: number) {
  const target = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return target;
}
function formatDate(value: string) { return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(localDate(value)); }

export default function MemoriesScreen() {
  const db = useSQLiteContext();
  const { readingTheme, readingBodyStyle, readingFontFamily, fontScale } = useAppPreferences();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [suppressed, setSuppressed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<MemoryMode>('random');
  const [modePickerVisible, setModePickerVisible] = useState(false);
  const [yearPickerVisible, setYearPickerVisible] = useState(false);
  const modeButtonRef = useRef<View>(null);
  const yearListRef = useRef<ScrollView>(null);
  const [modeAnchor, setModeAnchor] = useState<{ x: number; y: number; width: number; height: number }>({ x: spacing.xl, y: 0, width: 96, height: 32 });
  const [hideConfirmationVisible, setHideConfirmationVisible] = useState(false);
  const [tag, setTag] = useState<string | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const pickedIdRef = useRef<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const currentYearRef = useRef(now.getFullYear());

  const load = useCallback(async () => {
    try {
      const [items, hiddenIds] = await Promise.all([listEntries(db), listSuppressedMemoryEntryIds(db)]);
      setEntries(items); setSuppressed(new Set(hiddenIds));
    } catch { await showAppDialog({ title: '暂时无法拾起记录', message: '请稍后再试。' }); }
    finally { setLoading(false); }
  }, [db]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useFocusEffect(useCallback(() => {
    const current = new Date();
    const previousYear = currentYearRef.current;
    currentYearRef.current = current.getFullYear();
    setNow(current);
    setSelectedYear((year) => year === previousYear ? current.getFullYear() : year);
  }, []));

  const tags = useMemo(() => [...new Set(entries.flatMap((entry) => entry.tags))].sort((a, b) => a.localeCompare(b, 'zh-CN')), [entries]);
  const candidates = useMemo(() => {
    const available = entries.filter((entry) => !suppressed.has(entry.id));
    if (mode === 'random') return available.filter((entry) => localDate(entry.occurredAt) <= now);
    if (mode === 'today') return available.filter((entry) => {
      const date = localDate(entry.occurredAt);
      return date.getFullYear() < now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
    });
    if (mode === 'month') {
      const target = shiftedMonthDate(now, -1);
      return available.filter((entry) => sameDay(localDate(entry.occurredAt), target));
    }
    if (mode === 'yearWeek') {
      const target = new Date(now); target.setFullYear(now.getFullYear() - 1);
      const monday = startOfDay(target); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const end = new Date(monday); end.setDate(end.getDate() + 7);
      return available.filter((entry) => { const date = localDate(entry.occurredAt); return date >= monday && date < end; });
    }
    return tag ? available.filter((entry) => entry.tags.includes(tag)) : [];
  }, [entries, mode, now, suppressed, tag]);
  const candidateIds = useMemo(() => candidates.map((entry) => entry.id), [candidates]);
  const picked = candidates.find((entry) => entry.id === pickedId) ?? null;

  useEffect(() => {
    const nextId = pickRandomMemoryId(candidateIds, pickedIdRef.current);
    pickedIdRef.current = nextId;
    setPickedId(nextId);
  }, [candidateIds]);

  function pickNext() {
    const nextId = pickRandomMemoryId(candidateIds, pickedIdRef.current);
    pickedIdRef.current = nextId;
    setPickedId(nextId);
  }

  const weekEntries = useMemo(() => { const start = startOfDay(now); start.setDate(start.getDate() - 6); return entries.filter((entry) => localDate(entry.occurredAt) >= start); }, [entries, now]);
  const monthEntries = useMemo(() => entries.filter((entry) => { const date = localDate(entry.occurredAt); return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth(); }), [entries, now]);
  const footprintYearData = useMemo(() => {
    const counts = new Map<number, number>();
    let firstYear = now.getFullYear();
    let lastYear = now.getFullYear();
    for (const entry of entries) {
      const year = localDate(entry.occurredAt).getFullYear();
      counts.set(year, (counts.get(year) ?? 0) + 1);
      firstYear = Math.min(firstYear, year);
      lastYear = Math.max(lastYear, year);
    }
    return { counts, years: Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index) };
  }, [entries, now]);
  const footprintYears = footprintYearData.years;
  const footprintYear = footprintYears.includes(selectedYear) ? selectedYear : now.getFullYear();
  const selectedYearIndex = footprintYears.indexOf(footprintYear);
  const previousYear = selectedYearIndex > 0 ? footprintYears[selectedYearIndex - 1] : null;
  const nextYear = selectedYearIndex >= 0 && selectedYearIndex < footprintYears.length - 1 ? footprintYears[selectedYearIndex + 1] : null;

  async function hidePicked() {
    if (!picked) return;
    try {
      await suppressMemoryEntry(db, picked.id);
      setSuppressed((current) => new Set(current).add(picked.id));
      pickNext();
    } catch { await showAppDialog({ title: '操作失败', message: '暂时无法隐藏这条记录。' }); }
  }

  function confirmHidePicked() {
    if (!picked) return;
    setHideConfirmationVisible(true);
  }

  const modeLabel = modes.find((item) => item.value === mode)?.label ?? '随缘拾起';
  function openModePicker() {
    modeButtonRef.current?.measureInWindow((x, y, width, height) => {
      setModeAnchor({ x, y, width, height });
      setModePickerVisible(true);
    });
  }

  if (loading) return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}><ActivityIndicator color={colors.primary} style={styles.loader} /></SafeAreaView>;
  return <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}><Pressable accessibilityLabel="返回" onPress={() => router.back()} hitSlop={12}><Text style={styles.back}>‹ 返回</Text></Pressable><Text style={[styles.title, { color: readingTheme.text }]}>拾起一刻</Text><View style={styles.headerSpace} /></View>
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.modeRow}><Pressable ref={modeButtonRef} accessibilityLabel="选择拾取方式" onPress={openModePicker} style={[styles.modeButton, { backgroundColor: readingTheme.surface }]}><Text style={styles.modeButtonText}>{modeLabel}</Text><View style={[styles.modeChevron, modePickerVisible && styles.modeChevronOpen]} /></Pressable><Text style={[styles.candidateCount, { color: readingTheme.secondary }]}>{candidates.length ? `${candidates.length} 条可拾起` : '暂无记录'}</Text><Pressable accessibilityLabel="再拾一条" onPress={pickNext} style={styles.shuffleButton}><SymbolView name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }} size={17} tintColor="#FFFFFF" /></Pressable></View>
      {mode === 'tag' ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tagRow}>{tags.map((item) => <Pressable key={item} onPress={() => setTag(item)} style={[styles.tagChip, { backgroundColor: tag === item ? colors.primary : readingTheme.surface }]}><Text style={[styles.tagText, { color: tag === item ? '#FFFFFF' : readingTheme.secondary }, tag === item && styles.tagTextActive]}>#{item}</Text></Pressable>)}</ScrollView> : null}

      {picked ? <View style={[styles.memoryCard, { backgroundColor: readingTheme.surface }]}>
        <View style={styles.memoryHeader}><Text style={styles.memoryDate}>{formatDate(picked.occurredAt)}</Text><Pressable accessibilityLabel="回忆操作" onPress={confirmHidePicked} hitSlop={10}><Text style={[styles.memoryMenu, { color: readingTheme.secondary }]}>•••</Text></Pressable></View>
        <Pressable onPress={() => router.push({ pathname: '/entry/[id]', params: { id: picked.id } })} style={[styles.memoryBody, !picked.images.length && styles.memoryBodyWithoutImage]}>
          <MemoryThumbnails images={picked.images} />
          <View style={styles.memoryText}>
            <Text numberOfLines={5} style={[styles.memoryContent, { color: readingBodyStyle.color, fontFamily: readingFontFamily, fontSize: 15 * fontScale, lineHeight: 23 * fontScale * readingBodyStyle.lineHeightMultiplier, letterSpacing: readingBodyStyle.letterSpacing }]}>{picked.content}</Text>
            {picked.mood || picked.weather ? <Text style={[styles.meta, { color: readingTheme.secondary }]}>{[picked.mood, picked.weather].filter(Boolean).join(' · ')}</Text> : null}
          </View>
        </Pressable>
      </View> : <View style={[styles.empty, { backgroundColor: readingTheme.surface }]}><Text style={[styles.emptyTitle, { color: readingTheme.text }]}>{mode === 'tag' && !tag ? '先选择一个标签' : '今天没有可拾起的记录'}</Text><Text style={[styles.emptyText, { color: readingTheme.secondary }]}>换一种方式看看，过去会在别处等你。</Text></View>}
      <Text style={[styles.sectionTitle, { color: readingTheme.text }]}>近况回顾</Text>
      <View style={[styles.reviewGroup, { backgroundColor: readingTheme.surface }]}>
        <ReviewStrip weekEntries={weekEntries} monthEntries={monthEntries} month={now.getMonth() + 1} />
      </View>
      <Pressable
        accessibilityLabel="查看时光总结"
        onPress={() => router.push({ pathname: '/summaries', params: { period: 'month' } })}
        style={({ pressed }) => [styles.summaryLink, { backgroundColor: readingTheme.surface }, pressed && styles.summaryLinkPressed]}
      >
        <View style={styles.summaryIcon}><SymbolView name={{ ios: 'chart.line.uptrend.xyaxis', android: 'insights', web: 'insights' }} size={18} tintColor={colors.primary} /></View>
        <View style={styles.summaryCopy}>
          <Text style={styles.summaryLinkTitle}>时光总结</Text>
          <Text style={[styles.summaryLinkDescription, { color: readingTheme.secondary }]}>查看周、月与年度记录趋势</Text>
        </View>
        <Text style={styles.summaryLinkArrow}>›</Text>
      </Pressable>
      <Pressable
        accessibilityLabel="查看年度回顾"
        onPress={() => router.push({ pathname: '/summaries', params: { period: 'year' } })}
        style={({ pressed }) => [styles.summaryLink, { backgroundColor: readingTheme.surface }, pressed && styles.summaryLinkPressed]}
      >
        <View style={styles.summaryIcon}><SymbolView name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }} size={18} tintColor={colors.primary} /></View>
        <View style={styles.summaryCopy}>
          <Text style={styles.summaryLinkTitle}>年度回顾</Text>
          <Text style={[styles.summaryLinkDescription, { color: readingTheme.secondary }]}>看看一年的轮廓与代表时刻</Text>
        </View>
        <Text style={styles.summaryLinkArrow}>›</Text>
      </Pressable>
      <Pressable
        accessibilityLabel="查看时间胶囊"
        onPress={() => router.push('/time-capsules' as Href)}
        style={({ pressed }) => [styles.summaryLink, { backgroundColor: readingTheme.surface }, pressed && styles.summaryLinkPressed]}
      >
        <View style={styles.summaryIcon}><SymbolView name={{ ios: 'lock', android: 'lock', web: 'lock' }} size={18} tintColor={colors.primary} /></View>
        <View style={styles.summaryCopy}>
          <Text style={styles.summaryLinkTitle}>时间胶囊</Text>
          <Text style={[styles.summaryLinkDescription, { color: readingTheme.secondary }]}>给未来的自己留下一些话</Text>
        </View>
        <Text style={styles.summaryLinkArrow}>›</Text>
      </Pressable>
      <Pressable
        accessibilityLabel="打开足迹地图"
        onPress={() => router.push('/footprint-map' as Href)}
        style={({ pressed }) => [styles.summaryLink, { backgroundColor: readingTheme.surface }, pressed && styles.summaryLinkPressed]}
      >
        <View style={styles.summaryIcon}><SymbolView name={{ ios: 'map', android: 'map', web: 'map' }} size={18} tintColor={colors.primary} /></View>
        <View style={styles.summaryCopy}>
          <Text style={styles.summaryLinkTitle}>足迹地图</Text>
          <Text style={[styles.summaryLinkDescription, { color: readingTheme.secondary }]}>点亮保存过坐标的地点</Text>
        </View>
        <Text style={styles.summaryLinkArrow}>›</Text>
      </Pressable>
      <View style={styles.footprintYearHeader}>
        <Pressable accessibilityLabel={previousYear ? `查看 ${previousYear} 年足迹` : '已经是最早年份'} disabled={!previousYear} onPress={() => previousYear && setSelectedYear(previousYear)} style={[styles.yearButton, { backgroundColor: readingTheme.surface }, !previousYear && styles.yearButtonDisabled]}><Text style={styles.yearButtonText}>‹</Text></Pressable>
        <Pressable accessibilityLabel={`选择足迹年份，当前 ${footprintYear} 年`} onPress={() => setYearPickerVisible(true)} style={styles.footprintYearTitle}><View style={styles.yearTitleRow}><Text style={[styles.sectionTitle, styles.footprintSectionTitle, { color: readingTheme.text }]}>{footprintYear} 年足迹</Text><View style={styles.yearTitleChevron} /></View><Text style={[styles.yearHint, { color: readingTheme.secondary }]}>{footprintYear === now.getFullYear() ? '今年 · 点击选择年份' : `${footprintYearData.counts.get(footprintYear) ?? 0} 条记录 · 点击选择年份`}</Text></Pressable>
        <Pressable accessibilityLabel={nextYear ? `查看 ${nextYear} 年足迹` : '已经是最新年份'} disabled={!nextYear} onPress={() => nextYear && setSelectedYear(nextYear)} style={[styles.yearButton, { backgroundColor: readingTheme.surface }, !nextYear && styles.yearButtonDisabled]}><Text style={styles.yearButtonText}>›</Text></Pressable>
      </View>
      <Heatmap entries={entries} year={footprintYear} />
    </ScrollView>
    <Modal visible={modePickerVisible} transparent animationType="fade" onRequestClose={() => setModePickerVisible(false)}><Pressable onPress={() => setModePickerVisible(false)} style={styles.overlay}><Pressable onPress={(event) => event.stopPropagation()} style={[styles.modePicker, { backgroundColor: readingTheme.background, left: modeAnchor.x, top: modeAnchor.y + modeAnchor.height + 2, minWidth: Math.max(modeAnchor.width, 132) }]}>{modes.map((item) => <Pressable accessibilityRole="menuitem" key={item.value} onPress={() => { setMode(item.value); setModePickerVisible(false); }} style={({ pressed }) => [styles.pickerItem, pressed && { backgroundColor: readingTheme.surface }]}><Text style={[styles.pickerItemText, { color: mode === item.value ? colors.primary : readingTheme.text }, mode === item.value && styles.pickerItemActive]}>{item.label}</Text>{mode === item.value ? <Text style={styles.check}>✓</Text> : null}</Pressable>)}</Pressable></Pressable></Modal>
    <Modal visible={yearPickerVisible} transparent animationType="fade" onRequestClose={() => setYearPickerVisible(false)} onShow={() => { const index = [...footprintYears].reverse().indexOf(footprintYear); requestAnimationFrame(() => yearListRef.current?.scrollTo({ y: Math.max(0, index * 58), animated: false })); }}><Pressable accessibilityLabel="关闭年份选择" onPress={() => setYearPickerVisible(false)} style={styles.yearOverlay}><Pressable onPress={(event) => event.stopPropagation()} style={[styles.yearPicker, { backgroundColor: readingTheme.background }]}><Text style={[styles.yearPickerTitle, { color: readingTheme.text }]}>选择足迹年份</Text><ScrollView ref={yearListRef} style={styles.yearList} showsVerticalScrollIndicator>{[...footprintYears].reverse().map((year) => { const count = footprintYearData.counts.get(year) ?? 0; const active = year === footprintYear; return <Pressable accessibilityRole="menuitem" key={year} onPress={() => { setSelectedYear(year); setYearPickerVisible(false); }} style={[styles.yearPickerItem, { borderBottomColor: readingTheme.border }, active && { backgroundColor: readingTheme.surface }]}><View><Text style={[styles.yearPickerItemTitle, { color: active ? colors.primary : readingTheme.text }]}>{year} 年</Text><Text style={[styles.yearPickerItemCount, { color: readingTheme.secondary }]}>{count ? `${count} 条记录` : '这一年还没有记录'}</Text></View>{active ? <Text style={styles.check}>✓</Text> : null}</Pressable>; })}</ScrollView><Pressable onPress={() => setYearPickerVisible(false)} style={styles.yearPickerCancel}><Text style={[styles.yearPickerCancelText, { color: readingTheme.secondary }]}>取消</Text></Pressable></Pressable></Pressable></Modal>
    <AppDialog visible={hideConfirmationVisible} title="不再推荐这条记录？" message="它仍会保留在时间轴中，只是不再出现在“拾起一刻”。" onClose={() => setHideConfirmationVisible(false)} actions={[{ label: '取消', onPress: () => setHideConfirmationVisible(false) }, { label: '不再推荐', tone: 'danger', onPress: async () => { setHideConfirmationVisible(false); await hidePicked(); } }]} />
  </SafeAreaView>;
}

function MemoryThumbnails({ images }: { images: Entry['images'] }) {
  if (!images.length) return null;
  if (images.length === 1) return <MediaThumbnail media={images[0]} allowRuntimeVideoPoster style={styles.singleThumbnail} />;
  const visible = images.slice(0, 4);
  return <View style={styles.thumbnailGrid}>
    {visible.map((image, index) => <View key={image.id} style={styles.thumbnailCell}>
      <MediaThumbnail media={image} allowRuntimeVideoPoster style={styles.thumbnailImage} />
      {index === 3 && images.length > 4 ? <View style={styles.thumbnailMore}><Text style={styles.thumbnailMoreText}>+{images.length - 3}</Text></View> : null}
    </View>)}
  </View>;
}

function ReviewStrip({ weekEntries, monthEntries, month }: { weekEntries: Entry[]; monthEntries: Entry[]; month: number }) {
  const { readingTheme } = useAppPreferences();
  const weekImages = weekEntries.reduce((total, entry) => total + entry.images.length, 0);
  const monthImages = monthEntries.reduce((total, entry) => total + entry.images.length, 0);
  return <View style={styles.reviewStrip}><ReviewMetric title="最近 7 天" count={weekEntries.length} images={weekImages} /><View style={[styles.reviewDivider, { backgroundColor: readingTheme.border }]} /><ReviewMetric title={`${month} 月`} count={monthEntries.length} images={monthImages} /></View>;
}

function ReviewMetric({ title, count, images }: { title: string; count: number; images: number }) {
  const { readingTheme } = useAppPreferences();
  return <View style={styles.reviewMetric}><Text style={styles.reviewTitle}>{title}</Text><Text style={[styles.reviewValue, { color: readingTheme.text }]}>{count} 条</Text><Text style={[styles.reviewLabel, { color: readingTheme.secondary }]}>{images} 张图片</Text></View>;
}

function Heatmap({ entries, year }: { entries: Entry[]; year: number }) {
  const { readingTheme } = useAppPreferences();
  const scrollRef = useRef<ScrollView>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [contentReady, setContentReady] = useState(false);
  const counts = useMemo(() => { const map = new Map<string, number>(); entries.forEach((entry) => { const date = localDate(entry.occurredAt); if (date.getFullYear() !== year) return; const key = `${date.getMonth() + 1}-${date.getDate()}`; map.set(key, (map.get(key) ?? 0) + 1); }); return map; }, [entries, year]);
  const first = new Date(year, 0, 1); const last = new Date(year, 11, 31);
  const cursor = new Date(first); cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
  const weeks: Date[][] = [];
  while (cursor <= last) { const week: Date[] = []; for (let day = 0; day < 7; day += 1) { week.push(new Date(cursor)); cursor.setDate(cursor.getDate() + 1); } weeks.push(week); }
  const monthStarts = Array.from({ length: 12 }, (_, month) => {
    const index = weeks.findIndex((week) => week.some((day) => day.getFullYear() === year && day.getMonth() === month && day.getDate() === 1));
    return { month, index: Math.max(0, index) };
  });
  const today = useMemo(() => new Date(), []);
  const currentWeek = weeks.findIndex((week) => week.some((date) => sameDay(date, today)));
  useEffect(() => {
    if (!contentReady || !viewportWidth) return;
    const x = currentWeek >= 0 && today.getFullYear() === year
      ? Math.max(0, currentWeek * 11 - viewportWidth * 0.55)
      : 0;
    scrollRef.current?.scrollTo({ x, animated: false });
  }, [contentReady, currentWeek, today, viewportWidth, year]);
  return <View style={[styles.heatCard, { backgroundColor: readingTheme.surface }]} onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}>
    <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false} onContentSizeChange={() => setContentReady(true)}>
      <View style={styles.heatContent}>
        <View style={styles.monthLabels}>{monthStarts.map(({ month, index }) => <Text key={month} style={[styles.monthLabel, { left: index * 11, color: readingTheme.secondary }]}>{month + 1}月</Text>)}</View>
        <View style={styles.heatmap}>{weeks.map((week, index) => <View key={index} style={styles.heatWeek}>{week.map((date) => { const count = date.getFullYear() === year ? counts.get(`${date.getMonth() + 1}-${date.getDate()}`) ?? 0 : -1; return <View key={date.toISOString()} accessibilityLabel={count > 0 ? `${date.getMonth() + 1}月${date.getDate()}日，${count}条记录` : undefined} style={[styles.heatCell, { backgroundColor: readingTheme.border }, count < 0 && styles.heatOutside, count === 1 && styles.heatOne, count === 2 && styles.heatTwo, count >= 3 && styles.heatMany]} />; })}</View>)}</View>
      </View>
    </ScrollView>
    <View style={styles.heatLegend}><Text style={[styles.legendText, { color: readingTheme.secondary }]}>少</Text><View style={[styles.heatCell, { backgroundColor: readingTheme.border }]} /><View style={[styles.heatCell, styles.heatOne]} /><View style={[styles.heatCell, styles.heatTwo]} /><View style={[styles.heatCell, styles.heatMany]} /><Text style={[styles.legendText, { color: readingTheme.secondary }]}>多</Text></View>
  </View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, loader: { marginTop: 100 }, header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, back: { color: colors.primary, fontSize: 13 }, title: { color: colors.text, fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, headerSpace: { width: 42 }, scroll: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: 40 },
  modeRow: { height: 32, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }, modeButton: { height: 28, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.primarySoft }, modeButtonText: { color: colors.primary, fontSize: 10, lineHeight: 14, fontWeight: '700' }, modeChevron: { width: 6, height: 6, marginTop: -2, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: colors.primary, transform: [{ rotate: '45deg' }] }, candidateCount: { flex: 1, color: colors.textFaint, fontSize: 9, textAlign: 'right' }, shuffleButton: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.primary }, shuffleText: { color: '#FFFFFF', fontSize: 16, lineHeight: 19, textAlign: 'center', includeFontPadding: false }, tagRow: { gap: spacing.xs, paddingBottom: spacing.sm }, tagChip: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted }, tagText: { color: colors.textSecondary, fontSize: 10 }, tagTextActive: { fontWeight: '700' },
  modeChevronOpen: { marginTop: 3, transform: [{ rotate: '-135deg' }] },
  memoryCard: { padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surfaceMuted }, memoryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, memoryDate: { color: colors.primary, fontSize: 10, fontWeight: '700' }, memoryMenu: { color: colors.textSecondary, fontSize: 13, letterSpacing: 1 }, memoryBody: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginTop: spacing.sm }, memoryBodyWithoutImage: { marginTop: spacing.xs }, memoryText: { flex: 1, minHeight: 88 }, memoryContent: { color: colors.text, fontFamily: fonts.serif, fontSize: 15, lineHeight: 23 }, meta: { marginTop: spacing.xs, color: colors.textSecondary, fontSize: 10 }, singleThumbnail: { width: 88, height: 88, borderRadius: radii.md, backgroundColor: colors.border }, thumbnailGrid: { width: 88, height: 88, flexDirection: 'row', flexWrap: 'wrap', gap: 4 }, thumbnailCell: { position: 'relative', width: 42, height: 42 }, thumbnailImage: { width: 42, height: 42, borderRadius: radii.sm, backgroundColor: colors.border }, thumbnailMore: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', borderRadius: radii.sm, backgroundColor: '#00000073' }, thumbnailMoreText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' }, empty: { alignItems: 'center', paddingVertical: 32, borderRadius: radii.lg, backgroundColor: colors.surfaceMuted }, emptyTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 16 }, emptyText: { marginTop: spacing.sm, color: colors.textFaint, fontSize: 10 },
  sectionTitle: { marginTop: spacing.xl, marginBottom: spacing.sm, color: colors.text, fontFamily: fonts.serif, fontSize: 14, fontWeight: '600' }, reviewGroup: { overflow: 'hidden', borderRadius: radii.lg }, reviewStrip: { minHeight: 78, flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md }, reviewMetric: { flex: 1, alignItems: 'center', justifyContent: 'center' }, reviewDivider: { width: StyleSheet.hairlineWidth, height: 42, backgroundColor: colors.border }, reviewTitle: { color: colors.primary, fontSize: 10, lineHeight: 13, fontWeight: '700' }, reviewValue: { marginTop: 3, color: colors.text, fontFamily: fonts.serif, fontSize: 14, lineHeight: 18 }, reviewLabel: { marginTop: 2, color: colors.textFaint, fontSize: 9, lineHeight: 12 },
  summaryLink: { minHeight: 64, flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, paddingHorizontal: spacing.md, borderRadius: radii.lg }, summaryLinkPressed: { opacity: 0.62 }, summaryIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: colors.primarySoft }, summaryCopy: { flex: 1, marginLeft: spacing.md }, summaryLinkTitle: { color: colors.primary, fontSize: 13, lineHeight: 17, fontWeight: '700' }, summaryLinkDescription: { marginTop: 2, fontSize: 10, lineHeight: 13 }, summaryLinkArrow: { color: colors.primary, fontSize: 17 },
  footprintYearHeader: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg, marginBottom: spacing.sm }, footprintYearTitle: { alignItems: 'center' }, yearTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 }, yearTitleChevron: { width: 6, height: 6, marginTop: -3, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: colors.primary, transform: [{ rotate: '45deg' }] }, footprintSectionTitle: { marginTop: 0, marginBottom: 0 }, yearHint: { marginTop: 2, fontSize: 9 }, yearButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill }, yearButtonDisabled: { opacity: 0.28 }, yearButtonText: { color: colors.primary, fontSize: 22, lineHeight: 25 },
  yearOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.overlay }, yearPicker: { width: '100%', maxWidth: 320, maxHeight: '72%', padding: spacing.lg, borderRadius: radii.lg }, yearPickerTitle: { marginBottom: spacing.md, fontFamily: fonts.serif, fontSize: 18, fontWeight: '600', textAlign: 'center' }, yearList: { flexGrow: 0 }, yearPickerItem: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth }, yearPickerItemTitle: { fontSize: 13, fontWeight: '700' }, yearPickerItemCount: { marginTop: 3, fontSize: 9 }, yearPickerCancel: { minHeight: 42, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm }, yearPickerCancelText: { fontSize: 12, fontWeight: '600' },
  overlay: { flex: 1, backgroundColor: '#00000014' }, modePicker: { position: 'absolute', overflow: 'hidden', paddingVertical: spacing.xs, borderRadius: radii.md, backgroundColor: colors.background, elevation: 8, shadowColor: '#000000', shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } }, pickerItem: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: spacing.md }, pickerItemText: { color: colors.textSecondary, fontSize: 10, fontWeight: '600' }, pickerItemActive: { color: colors.primary, fontWeight: '700' }, check: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  heatCard: { padding: spacing.sm, borderRadius: radii.lg, backgroundColor: colors.surfaceMuted }, heatContent: { paddingTop: 16 }, monthLabels: { position: 'absolute', top: 0, left: 0, right: 0, height: 14 }, monthLabel: { position: 'absolute', width: 28, fontSize: 8, lineHeight: 11 }, heatmap: { flexDirection: 'row', gap: 3 }, heatWeek: { gap: 3 }, heatCell: { width: 8, height: 8, borderRadius: 2, backgroundColor: colors.border }, heatOutside: { opacity: 0 }, heatOne: { backgroundColor: '#B9D0C3' }, heatTwo: { backgroundColor: '#76A08D' }, heatMany: { backgroundColor: colors.primary }, heatLegend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: spacing.sm }, legendText: { color: colors.textFaint, fontSize: 8 },
});
