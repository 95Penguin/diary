import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, InteractionManager, Modal, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { MediaThumbnail, MediaViewer } from '@/components/media-view';
import { listJournalMedia } from '@/database/journal-repository';
import { removeMissingLibraryMediaReference, updateLibraryMediaThumbnail } from '@/database/media-maintenance';
import type { LibraryMedia } from '@/domain/journal';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { buildMediaLibraryRows, filterLibraryMedia, listMediaMonths, mediaPositionInSource, type MediaLibraryFilter, type MediaLibraryListItem, type MediaMonth } from '@/utils/media-library';
import { inspectMediaFile, type MediaMetadata } from '@/utils/media-metadata';
import { formatFileSize } from '@/utils/media-file-info';
import { createPersistentImageThumbnail } from '@/utils/image-thumbnail-cache';
import { createPersistentVideoThumbnail } from '@/utils/video-thumbnail-cache';
import { deleteJournalImage } from '@/utils/image-storage';
import { showAppDialog } from '@/components/app-dialog-host';

const FILTERS: { key: MediaLibraryFilter; label: string }[] = [
  { key: 'all', label: '全部' }, { key: 'image', label: '图片' }, { key: 'video', label: '视频' },
];
const MONTH_WHEEL_ITEM_HEIGHT = 52;

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
  const [monthIndexKey, setMonthIndexKey] = useState<string | null>(null);
  const [monthIndexYear, setMonthIndexYear] = useState<number | null>(null);
  const [details, setDetails] = useState<MediaMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [detailWorking, setDetailWorking] = useState(false);
  const listRef = useRef<FlatList<MediaLibraryListItem>>(null);
  const yearWheelRef = useRef<FlatList<number>>(null);
  const monthWheelRef = useRef<FlatList<MediaMonth>>(null);
  const monthIndexKeyRef = useRef<string | null>(null);
  const monthIndexYearRef = useRef<number | null>(null);
  const loadedRef = useRef(false);

  useFocusEffect(useCallback(() => {
    void reloadKey;
    let active = true;
    const firstLoad = !loadedRef.current;
    if (firstLoad) { setLoading(true); setLoadError(false); }
    const task = InteractionManager.runAfterInteractions(() => {
      void listJournalMedia(db).then((items) => {
        if (!active) return;
        loadedRef.current = true;
        setMedia(items);
        setLoadError(false);
        setLoading(false);
      }).catch(() => {
        if (active && firstLoad) { setLoadError(true); setLoading(false); }
      });
    });
    return () => { active = false; task.cancel(); };
  }, [db, reloadKey]));

  const filtered = useMemo(() => filterLibraryMedia(media, filter), [filter, media]);
  const rows = useMemo(() => buildMediaLibraryRows(filtered), [filtered]);
  const months = useMemo(() => listMediaMonths(rows), [rows]);
  const monthYears = useMemo(() => [...new Set(months.map((item) => Number(item.key.slice(0, 4))))].sort((left, right) => left - right), [months]);
  const selectedYearMonths = useMemo(() => months
    .filter((item) => Number(item.key.slice(0, 4)) === monthIndexYear)
    .sort((left, right) => Number(left.key.slice(5)) - Number(right.key.slice(5))), [monthIndexYear, months]);
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

  async function openDetails() {
    if (!preview) return;
    setDetails(await inspectMediaFile(preview.uri));
  }
  async function shareOriginal() {
    if (!preview || Platform.OS === 'web' || !await Sharing.isAvailableAsync()) return;
    await Sharing.shareAsync(preview.uri, { dialogTitle: '分享原始媒体', mimeType: preview.mediaType === 'video' ? 'video/*' : 'image/*' });
  }

  async function regenerateThumbnail() {
    if (!preview || !details?.exists || detailWorking) return;
    setDetailWorking(true);
    try {
      const thumbnailUri = preview.mediaType === 'video'
        ? await createPersistentVideoThumbnail(preview.uri)
        : await createPersistentImageThumbnail(preview.uri);
      if (!thumbnailUri) throw new Error('thumbnail-generation-failed');
      const updated = await updateLibraryMediaThumbnail(db, preview.source, preview.id, thumbnailUri);
      if (!updated) { deleteJournalImage(thumbnailUri); throw new Error('media-reference-missing'); }
      const previousThumbnail = preview.thumbnailUri;
      setMedia((items) => items.map((item) => item.id === preview.id && item.source === preview.source ? { ...item, thumbnailUri } : item));
      if (previousThumbnail && previousThumbnail !== thumbnailUri) deleteJournalImage(previousThumbnail);
      await showAppDialog({ title: '预览已恢复', message: '新的缩略图已经生成，原始媒体没有改动。' });
    } catch {
      await showAppDialog({ title: '无法生成预览', message: '原文件可能损坏，或当前格式暂不支持生成缩略图。' });
    } finally { setDetailWorking(false); }
  }

  async function removeMissingReference() {
    if (!preview || details?.exists || detailWorking) return;
    const decision = await showAppDialog({ title: '移除失效媒体？', message: '只会从这条记录中移除已经缺失的媒体关联，记录文字和其他媒体会保留。', actions: [{ label: '取消', value: 'cancel' }, { label: '移除', value: 'remove', tone: 'danger' }] });
    if (decision !== 'remove') return;
    setDetailWorking(true);
    try {
      const uris = await removeMissingLibraryMediaReference(db, preview.source, preview.id);
      uris.forEach(deleteJournalImage);
      setMedia((items) => items.filter((item) => !(item.id === preview.id && item.source === preview.source)));
      setDetails(null);
      setPreviewIndex(null);
      await showAppDialog({ title: '失效媒体已移除', message: '所属记录的文字和其他内容仍然保留。' });
    } catch {
      await showAppDialog({ title: '移除失败', message: '数据库没有发生不完整修改，请稍后重试。' });
    } finally { setDetailWorking(false); }
  }

  function goToMonth(rowIndex: number) {
    setMonthIndexVisible(false);
    requestAnimationFrame(() => listRef.current?.scrollToIndex({ index: rowIndex, animated: true, viewPosition: 0 }));
  }

  function openMonthIndex(key?: string) {
    if (!months.length) return;
    const selected = months.some((item) => item.key === key) ? key! : months[0].key;
    const year = Number(selected.slice(0, 4));
    monthIndexKeyRef.current = selected;
    monthIndexYearRef.current = year;
    setMonthIndexKey(selected);
    setMonthIndexYear(year);
    setMonthIndexVisible(true);
  }

  function selectMonthIndexYear(year: number) {
    const yearMonths = months.filter((item) => Number(item.key.slice(0, 4)) === year);
    const selected = yearMonths[0];
    monthIndexYearRef.current = year;
    setMonthIndexYear(year);
    if (selected) {
      monthIndexKeyRef.current = selected.key;
      setMonthIndexKey(selected.key);
      requestAnimationFrame(() => monthWheelRef.current?.scrollToOffset({ offset: 0, animated: false }));
    }
  }

  function updateYearWheel(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.max(0, Math.min(monthYears.length - 1, Math.round(event.nativeEvent.contentOffset.y / MONTH_WHEEL_ITEM_HEIGHT)));
    const year = monthYears[index];
    if (year != null && year !== monthIndexYearRef.current) selectMonthIndexYear(year);
  }

  function updateMonthWheel(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.max(0, Math.min(selectedYearMonths.length - 1, Math.round(event.nativeEvent.contentOffset.y / MONTH_WHEEL_ITEM_HEIGHT)));
    const key = selectedYearMonths[index]?.key ?? null;
    monthIndexKeyRef.current = key;
    setMonthIndexKey(key);
  }

  function confirmMonthIndex() {
    const selected = months.find((item) => item.key === monthIndexKeyRef.current);
    if (selected) goToMonth(selected.rowIndex);
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
    {loading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : loadError ? <View style={styles.empty}><Text style={[styles.emptyTitle, { color: readingTheme.text }]}>媒体暂时没有加载出来</Text><Text style={[styles.emptyText, { color: readingTheme.secondary }]}>内容仍保存在本机，可以重新加载。</Text><Pressable onPress={() => setReloadKey((value) => value + 1)} style={styles.retryButton}><Text style={styles.retryText}>重新加载</Text></Pressable></View> : rows.length ? <FlatList
      ref={(instance) => { listRef.current = instance; }} data={rows} keyExtractor={(item) => item.key} showsVerticalScrollIndicator={false}
      onScrollToIndexFailed={({ index, averageItemLength }) => { listRef.current?.scrollToOffset({ offset: Math.max(0, index * averageItemLength), animated: false }); setTimeout(() => listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0 }), 120); }}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => item.kind === 'header'
        ? <View style={styles.monthHeader}><Pressable accessibilityLabel={`选择月份，当前${item.label}`} hitSlop={8} onPress={() => openMonthIndex(item.key.replace('header-', ''))} style={styles.monthButton}><Text style={[styles.month, { color: readingTheme.text }]}>{item.label.replaceAll(' ', '')}</Text></Pressable><Text style={[styles.monthCount, { color: readingTheme.secondary }]}>{item.count} 项</Text></View>
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
          <Pressable accessibilityLabel="媒体详情" onPress={() => void openDetails()} style={styles.viewerButton}><Text style={styles.infoButtonText}>i</Text></Pressable>
        </View> : null}
        {preview && viewerChromeVisible ? <View style={[styles.viewerBottom, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}><View style={styles.viewerCaption}>{preview.source === 'followUp' ? <Text style={styles.viewerSource}>后续 · {formatDateTime(preview.attachedAt)}</Text> : null}<Text numberOfLines={3} style={styles.viewerDescription}>{preview.sourceContent || '这一刻没有写下文字'}</Text></View><Pressable accessibilityLabel="查看所属记录" onPress={() => openEntry(preview)} style={styles.openEntry}><Text style={styles.openEntryText}>查看记录</Text></Pressable></View> : null}
      </GestureHandlerRootView>
    </Modal>
    <Modal visible={details !== null} transparent animationType="fade" onRequestClose={() => setDetails(null)}><Pressable onPress={() => setDetails(null)} style={styles.detailOverlay}><Pressable onPress={(event) => event.stopPropagation()} style={[styles.detailSheet, { backgroundColor: readingTheme.background }]}><View style={styles.detailHeader}><Text style={[styles.detailTitle, { color: readingTheme.text }]}>媒体详情</Text><Pressable onPress={() => setDetails(null)}><Text style={[styles.detailClose, { color: readingTheme.secondary }]}>×</Text></Pressable></View>{preview && details ? <><DetailRow label="分辨率" value={`${preview.width} × ${preview.height}`} /><DetailRow label="文件大小" value={details.exists ? formatFileSize(details.bytes) : '原文件缺失'} danger={!details.exists} /><DetailRow label="格式" value={preview.mimeType ?? details.format} /><DetailRow label="原始文件名" value={preview.originalFilename ?? '未提供'} /><DetailRow label="拍摄时间" value={preview.capturedAt ? formatDateTime(preview.capturedAt) : '未提供'} /><DetailRow label="文件时间" value={details.createdAt ? formatDateTime(details.createdAt) : '文件未提供'} /><DetailRow label="加入拾时" value={formatDateTime(preview.attachedAt)} />{!details.exists ? <Text style={styles.missingHint}>数据库记录仍在，但本机原文件不存在。可以先从备份恢复，或移除这条失效媒体关联。</Text> : null}{details.exists ? <Pressable disabled={detailWorking || Platform.OS === 'web'} onPress={() => void regenerateThumbnail()} style={[styles.secondaryButton, (detailWorking || Platform.OS === 'web') && styles.shareDisabled]}><Text style={styles.secondaryButtonText}>{detailWorking ? '正在生成…' : '重新生成缩略图'}</Text></Pressable> : <Pressable disabled={detailWorking} onPress={() => void removeMissingReference()} style={[styles.removeButton, detailWorking && styles.shareDisabled]}><Text style={styles.removeButtonText}>{detailWorking ? '正在处理…' : '移除失效关联'}</Text></Pressable>}<Pressable disabled={!details.exists || Platform.OS === 'web' || detailWorking} onPress={() => void shareOriginal()} style={[styles.shareButton, (!details.exists || Platform.OS === 'web' || detailWorking) && styles.shareDisabled]}><Text style={styles.shareButtonText}>分享原文件</Text></Pressable></> : null}</Pressable></Pressable></Modal>
    <Modal visible={monthIndexVisible} transparent animationType="fade" onRequestClose={() => setMonthIndexVisible(false)} onShow={() => { const yearIndex = Math.max(0, monthYears.indexOf(monthIndexYearRef.current ?? monthYears[0])); const monthIndex = Math.max(0, selectedYearMonths.findIndex((item) => item.key === monthIndexKeyRef.current)); requestAnimationFrame(() => { yearWheelRef.current?.scrollToOffset({ offset: yearIndex * MONTH_WHEEL_ITEM_HEIGHT, animated: false }); monthWheelRef.current?.scrollToOffset({ offset: monthIndex * MONTH_WHEEL_ITEM_HEIGHT, animated: false }); }); }}>
      <Pressable accessibilityLabel="关闭月份索引" onPress={() => setMonthIndexVisible(false)} style={styles.monthOverlay}>
        <Pressable accessibilityRole="none" onPress={(event) => event.stopPropagation()} style={[styles.monthSheet, { backgroundColor: readingTheme.background, paddingBottom: Math.max(insets.bottom, spacing.xl) }]}>
          <View style={[styles.monthSheetHeader, { borderBottomColor: readingTheme.border }]}><Pressable hitSlop={12} onPress={() => setMonthIndexVisible(false)}><Text style={[styles.monthSheetAction, { color: readingTheme.secondary }]}>取消</Text></Pressable><Text style={[styles.monthSheetTitle, { color: readingTheme.text }]}>选择月份</Text><Pressable hitSlop={12} onPress={confirmMonthIndex}><Text style={styles.monthSheetAction}>确定</Text></Pressable></View>
          <View style={styles.monthWheel}><View pointerEvents="none" style={[styles.monthWheelSelection, { borderColor: readingTheme.border }]} /><FlatList ref={yearWheelRef} data={monthYears} keyExtractor={(year) => String(year)} showsVerticalScrollIndicator={false} snapToInterval={MONTH_WHEEL_ITEM_HEIGHT} decelerationRate="fast" contentContainerStyle={styles.monthWheelContent} getItemLayout={(_, index) => ({ index, length: MONTH_WHEEL_ITEM_HEIGHT, offset: MONTH_WHEEL_ITEM_HEIGHT * index })} onScrollEndDrag={updateYearWheel} onMomentumScrollEnd={updateYearWheel} renderItem={({ item: year }) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: year === monthIndexYear }} onPress={() => { selectMonthIndexYear(year); yearWheelRef.current?.scrollToOffset({ offset: monthYears.indexOf(year) * MONTH_WHEEL_ITEM_HEIGHT, animated: true }); }} style={styles.monthWheelItem}><Text style={[styles.monthWheelLabel, { color: year === monthIndexYear ? readingTheme.text : readingTheme.secondary }, year === monthIndexYear && styles.monthWheelLabelSelected]}>{year}年</Text></Pressable>} /><FlatList ref={monthWheelRef} data={selectedYearMonths} keyExtractor={(item) => item.key} showsVerticalScrollIndicator={false} snapToInterval={MONTH_WHEEL_ITEM_HEIGHT} decelerationRate="fast" contentContainerStyle={styles.monthWheelContent} getItemLayout={(_, index) => ({ index, length: MONTH_WHEEL_ITEM_HEIGHT, offset: MONTH_WHEEL_ITEM_HEIGHT * index })} onScrollEndDrag={updateMonthWheel} onMomentumScrollEnd={updateMonthWheel} renderItem={({ item, index }) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: item.key === monthIndexKey }} onPress={() => { monthIndexKeyRef.current = item.key; setMonthIndexKey(item.key); monthWheelRef.current?.scrollToOffset({ offset: index * MONTH_WHEEL_ITEM_HEIGHT, animated: true }); }} style={styles.monthWheelItem}><Text style={[styles.monthWheelLabel, { color: item.key === monthIndexKey ? readingTheme.text : readingTheme.secondary }, item.key === monthIndexKey && styles.monthWheelLabelSelected]}>{Number(item.key.slice(5))}月</Text><Text style={[styles.monthWheelCount, { color: readingTheme.secondary }]}>{item.count} 项</Text></Pressable>} /></View>
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
  monthHeader: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.sm, paddingBottom: 6 }, monthButton: { minHeight: 36, justifyContent: 'center' }, month: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '600' }, monthCount: { fontSize: 10, lineHeight: 14 },
  mediaRow: { flexDirection: 'row', marginBottom: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl }, emptyTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' }, emptyText: { marginTop: spacing.sm, fontSize: 12, textAlign: 'center' }, retryButton: { minHeight: 42, justifyContent: 'center', marginTop: spacing.lg, paddingHorizontal: spacing.xl, borderRadius: radii.pill, backgroundColor: colors.primary }, retryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  viewer: { flex: 1, backgroundColor: '#101411' }, viewerPager: { flex: 1 }, viewerPage: { flex: 1 }, viewerTop: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: '#00000066' },
  viewerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#FFFFFF22' }, viewerButtonText: { color: '#FFFFFF', fontSize: 30, lineHeight: 34, fontWeight: '300' }, infoButtonText:{color:'#FFFFFF',fontFamily:fonts.serif,fontSize:18,fontWeight:'700'}, viewerHeading: { flex: 1, alignItems: 'center' }, viewerDateTime: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' }, viewerCount: { marginTop: 2, color: '#FFFFFFCC', fontSize: 10, fontWeight: '600' }, viewerTopSpacer: { width: 40 },
  viewerBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, backgroundColor: '#00000088' }, viewerCaption: { flex: 1 }, viewerSource: { marginBottom: 3, color: '#FFFFFFB3', fontSize: 10, fontWeight: '700' }, viewerDescription: { color: '#FFFFFFE6', fontSize: 13, lineHeight: 20 },
  openEntry: { flexShrink: 0, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.pill, backgroundColor: '#FFFFFFE8' }, openEntryText: { color: colors.text, fontSize: 11, fontWeight: '700' },
  monthOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' }, monthSheet: { height: 352, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg }, monthSheetHeader: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth }, monthSheetTitle: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '700' }, monthSheetAction: { minWidth: 44, color: colors.primary, fontSize: 14, fontWeight: '600' }, monthWheel: { height: 260, overflow: 'hidden', flexDirection: 'row', justifyContent: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.lg }, monthWheelSelection: { position: 'absolute', left: spacing.xl, right: spacing.xl, top: 104, height: MONTH_WHEEL_ITEM_HEIGHT, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth }, monthWheelContent: { paddingVertical: 104 }, monthWheelItem: { width: 150, height: MONTH_WHEEL_ITEM_HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm }, monthWheelLabel: { fontSize: 15, textAlign: 'center' }, monthWheelLabelSelected: { fontSize: 18, fontWeight: '700' }, monthWheelCount: { minWidth: 38, fontSize: 10 },
  detailOverlay:{flex:1,justifyContent:'flex-end',backgroundColor:'#00000066'},detailSheet:{paddingHorizontal:spacing.xl,paddingTop:spacing.lg,paddingBottom:spacing.xxxl,borderTopLeftRadius:radii.lg,borderTopRightRadius:radii.lg},detailHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:spacing.md},detailTitle:{fontFamily:fonts.serif,fontSize:18,fontWeight:'700'},detailClose:{fontSize:26},detailRow:{minHeight:43,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#00000012'},detailLabel:{fontSize:12},detailValue:{fontSize:12,fontWeight:'600'},missingHint:{marginTop:spacing.md,color:colors.danger,fontSize:10,lineHeight:17},secondaryButton:{minHeight:44,alignItems:'center',justifyContent:'center',marginTop:spacing.xl,borderWidth:1,borderColor:colors.primary,borderRadius:radii.pill},secondaryButtonText:{color:colors.primary,fontSize:12,fontWeight:'700'},removeButton:{minHeight:44,alignItems:'center',justifyContent:'center',marginTop:spacing.xl,borderWidth:1,borderColor:colors.danger,borderRadius:radii.pill},removeButtonText:{color:colors.danger,fontSize:12,fontWeight:'700'},shareButton:{minHeight:44,alignItems:'center',justifyContent:'center',marginTop:spacing.md,borderRadius:radii.pill,backgroundColor:colors.primary},shareButtonText:{color:'#fff',fontSize:12,fontWeight:'700'},shareDisabled:{opacity:.4},
});

function DetailRow({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) { const { readingTheme } = useAppPreferences(); return <View style={styles.detailRow}><Text style={[styles.detailLabel,{color:readingTheme.secondary}]}>{label}</Text><Text style={[styles.detailValue,{color:danger?colors.danger:readingTheme.text}]}>{value}</Text></View>; }
