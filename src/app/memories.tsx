import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listEntries, listSuppressedMemoryEntryIds, suppressMemoryEntry } from '@/database/journal-repository';
import type { Entry } from '@/domain/journal';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { useAppPreferences } from '@/preferences/app-preferences';
import { AppDialog } from '@/components/app-dialog';
import { MediaThumbnail } from '@/components/media-view';

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
  const { readingTheme, readingFontFamily, fontScale } = useAppPreferences();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [suppressed, setSuppressed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<MemoryMode>('random');
  const [modePickerVisible, setModePickerVisible] = useState(false);
  const [hideConfirmationVisible, setHideConfirmationVisible] = useState(false);
  const [tag, setTag] = useState<string | null>(null);
  const [shuffle, setShuffle] = useState(() => Math.floor(Math.random() * 1_000_000));
  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    try {
      const [items, hiddenIds] = await Promise.all([listEntries(db), listSuppressedMemoryEntryIds(db)]);
      setEntries(items); setSuppressed(new Set(hiddenIds));
    } catch { Alert.alert('暂时无法拾起记录', '请稍后再试。'); }
    finally { setLoading(false); }
  }, [db]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const tags = useMemo(() => [...new Set(entries.flatMap((entry) => entry.tags))].sort((a, b) => a.localeCompare(b, 'zh-CN')), [entries]);
  const candidates = useMemo(() => {
    const available = entries.filter((entry) => !suppressed.has(entry.id));
    if (mode === 'random') return available.filter((entry) => startOfDay(localDate(entry.occurredAt)) < startOfDay(now));
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
  const picked = candidates.length ? candidates[Math.abs(shuffle) % candidates.length] : null;

  const weekEntries = useMemo(() => { const start = startOfDay(now); start.setDate(start.getDate() - 6); return entries.filter((entry) => localDate(entry.occurredAt) >= start); }, [entries, now]);
  const monthEntries = useMemo(() => entries.filter((entry) => { const date = localDate(entry.occurredAt); return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth(); }), [entries, now]);

  async function hidePicked() {
    if (!picked) return;
    try {
      await suppressMemoryEntry(db, picked.id);
      setSuppressed((current) => new Set(current).add(picked.id));
      setShuffle((value) => value + 1);
    } catch { Alert.alert('操作失败', '暂时无法隐藏这条记录。'); }
  }

  function confirmHidePicked() {
    if (!picked) return;
    setHideConfirmationVisible(true);
  }

  const modeLabel = modes.find((item) => item.value === mode)?.label ?? '随缘拾起';

  if (loading) return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}><ActivityIndicator color={colors.primary} style={styles.loader} /></SafeAreaView>;
  return <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}><Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.back}>‹ 返回</Text></Pressable><Text style={[styles.title, { color: readingTheme.text }]}>拾起一刻</Text><View style={styles.headerSpace} /></View>
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.modeRow}><Pressable accessibilityLabel="选择拾取方式" onPress={() => setModePickerVisible(true)} style={[styles.modeButton, { backgroundColor: readingTheme.surface }]}><Text style={styles.modeButtonText}>{modeLabel}</Text><View style={styles.modeChevron} /></Pressable><Text style={[styles.candidateCount, { color: readingTheme.secondary }]}>{candidates.length ? `${candidates.length} 条可拾起` : '暂无记录'}</Text><Pressable accessibilityLabel="再拾一条" onPress={() => setShuffle((value) => value + 1)} style={styles.shuffleButton}><Text style={styles.shuffleText}>↻</Text></Pressable></View>
      {mode === 'tag' ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tagRow}>{tags.map((item) => <Pressable key={item} onPress={() => { setTag(item); setShuffle(Math.floor(Math.random() * 1_000_000)); }} style={[styles.tagChip, { backgroundColor: tag === item ? colors.primary : readingTheme.surface }]}><Text style={[styles.tagText, { color: tag === item ? '#FFFFFF' : readingTheme.secondary }, tag === item && styles.tagTextActive]}>#{item}</Text></Pressable>)}</ScrollView> : null}

      {picked ? <View style={[styles.memoryCard, { backgroundColor: readingTheme.surface }]}>
        <View style={styles.memoryHeader}><Text style={styles.memoryDate}>{formatDate(picked.occurredAt)}</Text><Pressable accessibilityLabel="回忆操作" onPress={confirmHidePicked} hitSlop={10}><Text style={[styles.memoryMenu, { color: readingTheme.secondary }]}>•••</Text></Pressable></View>
        <Pressable onPress={() => router.push({ pathname: '/entry/[id]', params: { id: picked.id } })} style={[styles.memoryBody, !picked.images.length && styles.memoryBodyWithoutImage]}>
          <MemoryThumbnails images={picked.images} />
          <View style={styles.memoryText}>
            <Text numberOfLines={5} style={[styles.memoryContent, { color: readingTheme.text, fontFamily: readingFontFamily, fontSize: 15 * fontScale, lineHeight: 23 * fontScale }]}>{picked.content}</Text>
            {picked.mood || picked.weather ? <Text style={[styles.meta, { color: readingTheme.secondary }]}>{[picked.mood, picked.weather].filter(Boolean).join(' · ')}</Text> : null}
          </View>
        </Pressable>
      </View> : <View style={[styles.empty, { backgroundColor: readingTheme.surface }]}><Text style={[styles.emptyTitle, { color: readingTheme.text }]}>{mode === 'tag' && !tag ? '先选择一个标签' : '今天没有可拾起的记录'}</Text><Text style={[styles.emptyText, { color: readingTheme.secondary }]}>换一种方式看看，过去会在别处等你。</Text></View>}

      <Text style={[styles.sectionTitle, { color: readingTheme.text }]}>近况回顾</Text>
      <ReviewStrip weekEntries={weekEntries} monthEntries={monthEntries} month={now.getMonth() + 1} />
      <Text style={[styles.sectionTitle, { color: readingTheme.text }]}>{now.getFullYear()} 年足迹</Text>
      <Heatmap entries={entries} year={now.getFullYear()} />
    </ScrollView>
    <Modal visible={modePickerVisible} transparent animationType="fade" onRequestClose={() => setModePickerVisible(false)}><Pressable onPress={() => setModePickerVisible(false)} style={styles.overlay}><Pressable onPress={(event) => event.stopPropagation()} style={[styles.modePicker, { backgroundColor: readingTheme.background }]}><Text style={[styles.pickerTitle, { color: readingTheme.text }]}>怎样拾起过去？</Text>{modes.map((item) => <Pressable key={item.value} onPress={() => { setMode(item.value); setShuffle(Math.floor(Math.random() * 1_000_000)); setModePickerVisible(false); }} style={[styles.pickerItem, { borderBottomColor: readingTheme.border }]}><Text style={[styles.pickerItemText, { color: readingTheme.secondary }, mode === item.value && styles.pickerItemActive]}>{item.label}</Text>{mode === item.value ? <Text style={styles.check}>✓</Text> : null}</Pressable>)}<Pressable onPress={() => setModePickerVisible(false)} style={styles.pickerCancel}><Text style={[styles.pickerCancelText, { color: readingTheme.secondary }]}>取消</Text></Pressable></Pressable></Pressable></Modal>
    <AppDialog visible={hideConfirmationVisible} title="不再推荐这条记录？" message="它仍会保留在时间轴中，只是不再出现在“拾起一刻”。" onClose={() => setHideConfirmationVisible(false)} actions={[{ label: '取消', onPress: () => setHideConfirmationVisible(false) }, { label: '不再推荐', tone: 'danger', onPress: async () => { setHideConfirmationVisible(false); await hidePicked(); } }]} />
  </SafeAreaView>;
}

function MemoryThumbnails({ images }: { images: Entry['images'] }) {
  if (!images.length) return null;
  if (images.length === 1) return <MediaThumbnail media={images[0]} style={styles.singleThumbnail} />;
  const visible = images.slice(0, 4);
  return <View style={styles.thumbnailGrid}>
    {visible.map((image, index) => <View key={image.id} style={styles.thumbnailCell}>
      <MediaThumbnail media={image} style={styles.thumbnailImage} />
      {index === 3 && images.length > 4 ? <View style={styles.thumbnailMore}><Text style={styles.thumbnailMoreText}>+{images.length - 3}</Text></View> : null}
    </View>)}
  </View>;
}

function ReviewStrip({ weekEntries, monthEntries, month }: { weekEntries: Entry[]; monthEntries: Entry[]; month: number }) {
  const { readingTheme } = useAppPreferences();
  const weekImages = weekEntries.reduce((total, entry) => total + entry.images.length, 0);
  const monthImages = monthEntries.reduce((total, entry) => total + entry.images.length, 0);
  return <View style={[styles.reviewStrip, { backgroundColor: readingTheme.surface }]}><ReviewMetric title="最近 7 天" count={weekEntries.length} images={weekImages} /><View style={[styles.reviewDivider, { backgroundColor: readingTheme.border }]} /><ReviewMetric title={`${month} 月`} count={monthEntries.length} images={monthImages} /></View>;
}

function ReviewMetric({ title, count, images }: { title: string; count: number; images: number }) {
  const { readingTheme } = useAppPreferences();
  return <View style={styles.reviewMetric}><Text style={styles.reviewTitle}>{title}</Text><Text style={[styles.reviewValue, { color: readingTheme.text }]}>{count} 条</Text><Text style={[styles.reviewLabel, { color: readingTheme.secondary }]}>{images} 张图片</Text></View>;
}

function Heatmap({ entries, year }: { entries: Entry[]; year: number }) {
  const { readingTheme } = useAppPreferences();
  const counts = useMemo(() => { const map = new Map<string, number>(); entries.forEach((entry) => { const date = localDate(entry.occurredAt); if (date.getFullYear() !== year) return; const key = `${date.getMonth() + 1}-${date.getDate()}`; map.set(key, (map.get(key) ?? 0) + 1); }); return map; }, [entries, year]);
  const first = new Date(year, 0, 1); const last = new Date(year, 11, 31);
  const cursor = new Date(first); cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
  const weeks: Date[][] = [];
  while (cursor <= last) { const week: Date[] = []; for (let day = 0; day < 7; day += 1) { week.push(new Date(cursor)); cursor.setDate(cursor.getDate() + 1); } weeks.push(week); }
  return <View style={[styles.heatCard, { backgroundColor: readingTheme.surface }]}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.heatmap}>{weeks.map((week, index) => <View key={index} style={styles.heatWeek}>{week.map((date) => { const count = date.getFullYear() === year ? counts.get(`${date.getMonth() + 1}-${date.getDate()}`) ?? 0 : -1; return <View key={date.toISOString()} accessibilityLabel={count > 0 ? `${date.getMonth() + 1}月${date.getDate()}日，${count}条记录` : undefined} style={[styles.heatCell, { backgroundColor: readingTheme.border }, count < 0 && styles.heatOutside, count === 1 && styles.heatOne, count === 2 && styles.heatTwo, count >= 3 && styles.heatMany]} />; })}</View>)}</ScrollView><View style={styles.heatLegend}><Text style={[styles.legendText, { color: readingTheme.secondary }]}>少</Text><View style={[styles.heatCell, { backgroundColor: readingTheme.border }]} /><View style={[styles.heatCell, styles.heatOne]} /><View style={[styles.heatCell, styles.heatTwo]} /><View style={[styles.heatCell, styles.heatMany]} /><Text style={[styles.legendText, { color: readingTheme.secondary }]}>多</Text></View></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, loader: { marginTop: 100 }, header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, back: { color: colors.primary, fontSize: 13 }, title: { color: colors.text, fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, headerSpace: { width: 42 }, scroll: { padding: spacing.xl, paddingTop: spacing.md, paddingBottom: 56 },
  modeRow: { height: 40, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md }, modeButton: { height: 34, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.pill, backgroundColor: colors.primarySoft }, modeButtonText: { color: colors.primary, fontSize: 10, lineHeight: 14, fontWeight: '700' }, modeChevron: { width: 6, height: 6, marginTop: -2, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: colors.primary, transform: [{ rotate: '45deg' }] }, candidateCount: { flex: 1, color: colors.textFaint, fontSize: 9, textAlign: 'right' }, shuffleButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.primary }, shuffleText: { color: '#FFFFFF', fontSize: 19, lineHeight: 22, textAlign: 'center', includeFontPadding: false }, tagRow: { gap: spacing.sm, paddingBottom: spacing.md }, tagChip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted }, tagText: { color: colors.textSecondary, fontSize: 10 }, tagTextActive: { fontWeight: '700' },
  memoryCard: { padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surfaceMuted }, memoryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, memoryDate: { color: colors.primary, fontSize: 10, fontWeight: '700' }, memoryMenu: { color: colors.textSecondary, fontSize: 13, letterSpacing: 1 }, memoryBody: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginTop: spacing.md }, memoryBodyWithoutImage: { marginTop: spacing.sm }, memoryText: { flex: 1, minHeight: 104 }, memoryContent: { color: colors.text, fontFamily: fonts.serif, fontSize: 15, lineHeight: 23 }, meta: { marginTop: spacing.sm, color: colors.textSecondary, fontSize: 10 }, singleThumbnail: { width: 104, height: 104, borderRadius: radii.md, backgroundColor: colors.border }, thumbnailGrid: { width: 104, height: 104, flexDirection: 'row', flexWrap: 'wrap', gap: 4 }, thumbnailCell: { position: 'relative', width: 50, height: 50 }, thumbnailImage: { width: 50, height: 50, borderRadius: radii.sm, backgroundColor: colors.border }, thumbnailMore: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', borderRadius: radii.sm, backgroundColor: '#00000073' }, thumbnailMoreText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' }, empty: { alignItems: 'center', paddingVertical: 42, borderRadius: radii.lg, backgroundColor: colors.surfaceMuted }, emptyTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 16 }, emptyText: { marginTop: spacing.sm, color: colors.textFaint, fontSize: 10 },
  sectionTitle: { marginTop: spacing.xxl, marginBottom: spacing.md, color: colors.text, fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, reviewStrip: { minHeight: 74, flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surfaceMuted }, reviewMetric: { flex: 1, alignItems: 'center' }, reviewDivider: { width: StyleSheet.hairlineWidth, height: 42, backgroundColor: colors.border }, reviewTitle: { color: colors.primary, fontSize: 9, fontWeight: '700' }, reviewValue: { marginTop: 3, color: colors.text, fontFamily: fonts.serif, fontSize: 16 }, reviewLabel: { color: colors.textFaint, fontSize: 8 },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.overlay }, modePicker: { width: '100%', maxWidth: 300, padding: spacing.xl, borderRadius: radii.lg, backgroundColor: colors.background }, pickerTitle: { marginBottom: spacing.md, color: colors.text, fontFamily: fonts.serif, fontSize: 17, fontWeight: '600', textAlign: 'center' }, pickerItem: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, pickerItemText: { color: colors.textSecondary, fontSize: 12 }, pickerItemActive: { color: colors.primary, fontWeight: '700' }, check: { color: colors.primary, fontSize: 12 }, pickerCancel: { alignItems: 'center', paddingTop: spacing.lg }, pickerCancelText: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  heatCard: { padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surfaceMuted }, heatmap: { gap: 3 }, heatWeek: { gap: 3 }, heatCell: { width: 8, height: 8, borderRadius: 2, backgroundColor: colors.border }, heatOutside: { opacity: 0 }, heatOne: { backgroundColor: '#B9D0C3' }, heatTwo: { backgroundColor: '#76A08D' }, heatMany: { backgroundColor: colors.primary }, heatLegend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: spacing.md }, legendText: { color: colors.textFaint, fontSize: 8 },
});
