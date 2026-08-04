import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, InteractionManager, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { MediaThumbnail, MediaViewer } from '@/components/media-view';
import { listJournalMedia } from '@/database/journal-repository';
import type { LibraryMedia } from '@/domain/journal';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { buildMediaLibraryRows, filterLibraryMedia, listMediaMonths, mediaPositionInSource, type MediaLibraryFilter, type MediaLibraryListItem } from '@/utils/media-library';

const FILTERS: { key: MediaLibraryFilter; label: string }[] = [
  { key: 'all', label: '全部' }, { key: 'image', label: '图片' }, { key: 'video', label: '视频' },
];

export default function MediaLibraryScreen() {
  const db = useSQLiteContext();
  const { readingTheme } = useAppPreferences();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [media, setMedia] = useState<LibraryMedia[]>([]);
  const [filter, setFilter] = useState<MediaLibraryFilter>('all');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [viewerChromeVisible, setViewerChromeVisible] = useState(true);
  const [monthIndexVisible, setMonthIndexVisible] = useState(false);
  const [monthIndexYear, setMonthIndexYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const listRef = useRef<FlatList<MediaLibraryListItem>>(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    const task = InteractionManager.runAfterInteractions(() => {
      void listJournalMedia(db).then((items) => {
        if (!active) return;
        setMedia(items);
        setLoading(false);
      }).catch(() => {
        if (active) { setLoadError(true); setLoading(false); }
      });
    });
    return () => { active = false; task.cancel(); };
  }, [db]));

  const filtered = useMemo(() => filterLibraryMedia(media, filter), [filter, media]);
  const rows = useMemo(() => buildMediaLibraryRows(filtered), [filtered]);
  const months = useMemo(() => listMediaMonths(rows), [rows]);
  const monthYears = useMemo(() => [...new Set(months.map((item) => Number(item.key.slice(0, 4))))], [months]);
  const activeMonthYear = monthIndexYear && monthYears.includes(monthIndexYear) ? monthIndexYear : monthYears[0] ?? null;
  const activeYearMonths = useMemo(() => months.filter((item) => Number(item.key.slice(0, 4)) === activeMonthYear), [activeMonthYear, months]);
  const gap = 4;
  const horizontalPadding = spacing.md;
  const tileSize = Math.floor((width - horizontalPadding * 2 - gap * 2) / 3);

  function openEntry(item: LibraryMedia) {
    setPreviewIndex(null);
    router.push({ pathname: '/entry/[id]', params: { id: item.entryId } });
  }

  function openPreview(item: LibraryMedia) {
    const index = filtered.findIndex((medium) => medium.id === item.id && medium.source === item.source);
    if (index >= 0) { setViewerChromeVisible(true); setPreviewIndex(index); }
  }

  const preview = previewIndex === null ? null : filtered[previewIndex] ?? null;
  const previewPosition = preview ? mediaPositionInSource(filtered, preview) : null;

  function goToMonth(rowIndex: number) {
    setMonthIndexVisible(false);
    requestAnimationFrame(() => listRef.current?.scrollToIndex({ index: rowIndex, animated: true, viewPosition: 0 }));
  }

  function openMonthIndex(year?: number) {
    if (!months.length) return;
    setMonthIndexYear(year ?? monthYears[0] ?? null);
    setMonthIndexVisible(true);
  }

  return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}>
      <Pressable accessibilityLabel="返回" hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable>
      <Text style={[styles.title, { color: readingTheme.text }]}>媒体</Text>
      <Text accessibilityLabel={`共 ${media.length} 个媒体`} style={[styles.total, { color: readingTheme.secondary }]}>{media.length || ''}</Text>
    </View>
    <View style={[styles.filters, { borderBottomColor: readingTheme.border }]}>
      {FILTERS.map((item) => <Pressable
        accessibilityRole="radio" accessibilityState={{ checked: filter === item.key }} key={item.key}
        onPress={() => setFilter(item.key)} style={[styles.filter, filter === item.key && styles.filterActive]}
      ><Text style={[styles.filterText, { color: readingTheme.secondary }, filter === item.key && styles.filterTextActive]}>{item.label}</Text></Pressable>)}
    </View>
    {loading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : loadError ? <View style={styles.empty}><Text style={[styles.emptyTitle, { color: readingTheme.text }]}>媒体暂时没有加载出来</Text><Text style={[styles.emptyText, { color: readingTheme.secondary }]}>内容仍保存在本机，请返回后重试。</Text></View> : rows.length ? <FlatList
      ref={(instance) => { listRef.current = instance; }} data={rows} keyExtractor={(item) => item.key} showsVerticalScrollIndicator={false}
      onScrollToIndexFailed={({ index, averageItemLength }) => { listRef.current?.scrollToOffset({ offset: Math.max(0, index * averageItemLength), animated: false }); setTimeout(() => listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0 }), 120); }}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => item.kind === 'header'
        ? <View style={styles.monthHeader}><Pressable accessibilityLabel={`选择月份，当前${item.label}`} hitSlop={8} onPress={() => openMonthIndex(Number(item.key.slice(7, 11)))} style={styles.monthButton}><Text style={[styles.month, { color: readingTheme.text }]}>{item.label.replaceAll(' ', '')}</Text><View style={styles.monthChevron} /></Pressable><Text style={[styles.monthCount, { color: readingTheme.secondary }]}>{item.count} 项</Text></View>
        : <View style={[styles.mediaRow, { gap }]}>{item.media.map((medium) => <Pressable
          accessibilityLabel={`${formatDate(medium.occurredAt)}的${medium.mediaType === 'video' ? '视频' : '图片'}`}
          key={`${medium.source}-${medium.id}`} onPress={() => openPreview(medium)}
        ><MediaThumbnail media={medium} allowRuntimeVideoPoster style={{ width: tileSize, height: tileSize, borderRadius: radii.sm }} /></Pressable>)}</View>}
      initialNumToRender={12} maxToRenderPerBatch={12} windowSize={7}
    /> : <View style={styles.empty}><Text style={[styles.emptyTitle, { color: readingTheme.text }]}>{media.length ? '没有这类媒体' : '还没有图片或视频'}</Text><Text style={[styles.emptyText, { color: readingTheme.secondary }]}>{media.length ? '换一个筛选条件看看。' : '记录中的图片和视频会按月份出现在这里。'}</Text></View>}
    <Modal visible={previewIndex !== null} animationType="fade" onRequestClose={() => setPreviewIndex(null)}>
      <GestureHandlerRootView style={styles.viewer}>
        {previewIndex !== null ? <FlatList horizontal pagingEnabled data={filtered} initialScrollIndex={previewIndex} keyExtractor={(medium) => `${medium.source}-${medium.id}`} getItemLayout={(_, index) => ({ index, length: width, offset: width * index })} initialNumToRender={1} maxToRenderPerBatch={3} windowSize={3} removeClippedSubviews showsHorizontalScrollIndicator={false} style={styles.viewerPager} onMomentumScrollEnd={(event) => setPreviewIndex(Math.max(0, Math.min(filtered.length - 1, Math.round(event.nativeEvent.contentOffset.x / width))))} onScrollToIndexFailed={({ index }) => requestAnimationFrame(() => setPreviewIndex(index))} renderItem={({ item: medium }) => <View style={[styles.viewerPage, { width }]}><MediaViewer media={medium} onPress={() => setViewerChromeVisible((visible) => !visible)} /></View>} /> : null}
        {viewerChromeVisible ? <View style={[styles.viewerTop, { paddingTop: Math.max(insets.top, spacing.md) }]}> 
          <Pressable accessibilityLabel="关闭预览" onPress={() => setPreviewIndex(null)} style={styles.viewerButton}><Text style={styles.viewerButtonText}>×</Text></Pressable>
          {preview ? <View style={styles.viewerHeading}><Text style={styles.viewerDateTime}>{formatDateTime(preview.occurredAt)}</Text>{previewPosition && previewPosition.total > 1 ? <Text style={styles.viewerCount}>{previewPosition.index + 1} / {previewPosition.total}</Text> : null}</View> : null}
          <View style={styles.viewerTopSpacer} />
        </View> : null}
        {preview && viewerChromeVisible ? <View style={[styles.viewerBottom, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}><View style={styles.viewerCaption}>{preview.source === 'followUp' ? <Text style={styles.viewerSource}>后续 · {formatDateTime(preview.attachedAt)}</Text> : null}<Text numberOfLines={3} style={styles.viewerDescription}>{preview.sourceContent || '这一刻没有写下文字'}</Text></View><Pressable accessibilityLabel="查看所属记录" onPress={() => openEntry(preview)} style={styles.openEntry}><Text style={styles.openEntryText}>查看记录</Text></Pressable></View> : null}
      </GestureHandlerRootView>
    </Modal>
    <Modal visible={monthIndexVisible} transparent animationType="fade" onRequestClose={() => setMonthIndexVisible(false)}>
      <Pressable accessibilityLabel="关闭月份索引" onPress={() => setMonthIndexVisible(false)} style={styles.monthOverlay}>
        <Pressable accessibilityRole="none" onPress={(event) => event.stopPropagation()} style={[styles.monthSheet, { backgroundColor: readingTheme.background }]}>
          <View style={styles.monthSheetHeader}><Text style={[styles.monthSheetTitle, { color: readingTheme.text }]}>选择月份</Text><Pressable hitSlop={12} onPress={() => setMonthIndexVisible(false)}><Text style={[styles.monthSheetClose, { color: readingTheme.secondary }]}>×</Text></Pressable></View>
          <View style={styles.monthColumns}>
            <FlatList style={styles.yearColumn} data={monthYears} keyExtractor={(year) => String(year)} renderItem={({ item: year }) => <Pressable accessibilityRole="tab" accessibilityState={{ selected: year === activeMonthYear }} onPress={() => setMonthIndexYear(year)} style={[styles.yearChoice, year === activeMonthYear && { backgroundColor: readingTheme.surface }]}><Text style={[styles.yearChoiceText, { color: year === activeMonthYear ? colors.primary : readingTheme.secondary }]}>{year}年</Text></Pressable>} />
            <FlatList style={styles.monthColumn} data={activeYearMonths} keyExtractor={(item) => item.key} renderItem={({ item }) => <Pressable onPress={() => goToMonth(item.rowIndex)} style={[styles.monthChoice, { borderBottomColor: readingTheme.border }]}><Text style={[styles.monthChoiceLabel, { color: readingTheme.text }]}>{Number(item.key.slice(5))}月</Text><Text style={[styles.monthChoiceCount, { color: readingTheme.secondary }]}>{item.count} 项　›</Text></Pressable>} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  </SafeAreaView>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return `${formatDate(value)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { color: colors.primary, fontSize: 13 }, title: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, total: { width: 42, fontSize: 11, textAlign: 'right' },
  filters: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  filter: { minWidth: 58, alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radii.pill }, filterActive: { backgroundColor: colors.primarySoft },
  filterText: { fontSize: 12 }, filterTextActive: { color: colors.primary, fontWeight: '700' },
  loader: { flex: 1 }, list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxxl },
  monthHeader: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.sm, paddingBottom: 6 }, monthButton: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 7 }, month: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '600' }, monthChevron: { width: 6, height: 6, marginTop: -3, borderRightWidth: 1.4, borderBottomWidth: 1.4, borderColor: colors.primary, transform: [{ rotate: '45deg' }] }, monthCount: { fontSize: 10, lineHeight: 14 },
  mediaRow: { flexDirection: 'row', marginBottom: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl }, emptyTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' }, emptyText: { marginTop: spacing.sm, fontSize: 12, textAlign: 'center' },
  viewer: { flex: 1, backgroundColor: '#101411' }, viewerPager: { flex: 1 }, viewerPage: { flex: 1 }, viewerTop: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: '#00000066' },
  viewerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#FFFFFF22' }, viewerButtonText: { color: '#FFFFFF', fontSize: 30, lineHeight: 34, fontWeight: '300' }, viewerHeading: { flex: 1, alignItems: 'center' }, viewerDateTime: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' }, viewerCount: { marginTop: 2, color: '#FFFFFFCC', fontSize: 10, fontWeight: '600' }, viewerTopSpacer: { width: 40 },
  viewerBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, backgroundColor: '#00000088' }, viewerCaption: { flex: 1 }, viewerSource: { marginBottom: 3, color: '#FFFFFFB3', fontSize: 10, fontWeight: '700' }, viewerDescription: { color: '#FFFFFFE6', fontSize: 13, lineHeight: 20 },
  openEntry: { flexShrink: 0, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.pill, backgroundColor: '#FFFFFFE8' }, openEntryText: { color: colors.text, fontSize: 11, fontWeight: '700' },
  monthOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' }, monthSheet: { height: '56%', paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xxxl, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg }, monthSheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }, monthSheetTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '700' }, monthSheetClose: { fontSize: 26 }, monthColumns: { flex: 1, flexDirection: 'row', gap: spacing.md }, yearColumn: { width: 92, flexGrow: 0 }, monthColumn: { flex: 1 }, yearChoice: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md }, yearChoiceText: { fontSize: 12, fontWeight: '700' }, monthChoice: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth }, monthChoiceLabel: { fontSize: 14 }, monthChoiceCount: { fontSize: 11 },
});
