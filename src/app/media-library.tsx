import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { MediaThumbnail, MediaViewer } from '@/components/media-view';
import { listJournalMedia } from '@/database/journal-repository';
import type { LibraryMedia } from '@/domain/journal';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { buildMediaLibraryRows, filterLibraryMedia, type MediaLibraryFilter } from '@/utils/media-library';

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
  const [preview, setPreview] = useState<LibraryMedia | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    void listJournalMedia(db).then((items) => {
      if (!active) return;
      setMedia(items);
      setLoading(false);
    }).catch(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [db]));

  const filtered = useMemo(() => filterLibraryMedia(media, filter), [filter, media]);
  const rows = useMemo(() => buildMediaLibraryRows(filtered), [filtered]);
  const gap = 4;
  const horizontalPadding = spacing.md;
  const tileSize = Math.floor((width - horizontalPadding * 2 - gap * 2) / 3);

  function openEntry(item: LibraryMedia) {
    setPreview(null);
    router.push({ pathname: '/entry/[id]', params: { id: item.entryId } });
  }

  return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}>
      <Pressable accessibilityLabel="返回" hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable>
      <Text style={[styles.title, { color: readingTheme.text }]}>媒体</Text>
      <Text style={[styles.total, { color: readingTheme.secondary }]}>{media.length || ''}</Text>
    </View>
    <View style={[styles.filters, { borderBottomColor: readingTheme.border }]}>
      {FILTERS.map((item) => <Pressable
        accessibilityRole="radio" accessibilityState={{ checked: filter === item.key }} key={item.key}
        onPress={() => setFilter(item.key)} style={[styles.filter, filter === item.key && styles.filterActive]}
      ><Text style={[styles.filterText, { color: readingTheme.secondary }, filter === item.key && styles.filterTextActive]}>{item.label}</Text></Pressable>)}
    </View>
    {loading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : rows.length ? <FlatList
      data={rows} keyExtractor={(item) => item.key} showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => item.kind === 'header'
        ? <View style={styles.monthHeader}><Text style={[styles.month, { color: readingTheme.text }]}>{item.label}</Text><Text style={[styles.monthCount, { color: readingTheme.secondary }]}>{item.count} 项</Text></View>
        : <View style={[styles.mediaRow, { gap }]}>{item.media.map((medium) => <Pressable
          accessibilityLabel={`${formatDate(medium.occurredAt)}的${medium.mediaType === 'video' ? '视频' : '图片'}`}
          key={`${medium.source}-${medium.id}`} onPress={() => setPreview(medium)}
        ><MediaThumbnail media={medium} allowRuntimeVideoPoster style={{ width: tileSize, height: tileSize, borderRadius: radii.sm }} /></Pressable>)}</View>}
      initialNumToRender={12} maxToRenderPerBatch={12} windowSize={7}
    /> : <View style={styles.empty}><Text style={[styles.emptyTitle, { color: readingTheme.text }]}>{media.length ? '没有这类媒体' : '还没有图片或视频'}</Text><Text style={[styles.emptyText, { color: readingTheme.secondary }]}>{media.length ? '换一个筛选条件看看。' : '记录中的图片和视频会按月份出现在这里。'}</Text></View>}
    <Modal visible={Boolean(preview)} animationType="fade" onRequestClose={() => setPreview(null)}>
      <View style={styles.viewer}>
        {preview ? <MediaViewer media={preview} /> : null}
        <View style={[styles.viewerTop, { paddingTop: Math.max(insets.top, spacing.md) }]}>
          <Pressable accessibilityLabel="关闭预览" onPress={() => setPreview(null)} style={styles.viewerButton}><Text style={styles.viewerButtonText}>×</Text></Pressable>
          {preview ? <View style={styles.viewerCaption}><Text style={styles.viewerDate}>{formatDate(preview.occurredAt)}</Text><Text numberOfLines={1} style={styles.viewerDescription}>{preview.entryContent || '无文字记录'}</Text></View> : null}
        </View>
        {preview ? <Pressable onPress={() => openEntry(preview)} style={[styles.openEntry, { bottom: Math.max(insets.bottom, spacing.lg) }]}><Text style={styles.openEntryText}>查看所属记录</Text></Pressable> : null}
      </View>
    </Modal>
  </SafeAreaView>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { color: colors.primary, fontSize: 13 }, title: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, total: { width: 42, fontSize: 11, textAlign: 'right' },
  filters: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  filter: { minWidth: 58, alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radii.pill }, filterActive: { backgroundColor: colors.primarySoft },
  filterText: { fontSize: 12 }, filterTextActive: { color: colors.primary, fontWeight: '700' },
  loader: { flex: 1 }, list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxxl },
  monthHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingTop: spacing.xxl, paddingBottom: spacing.sm }, month: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, monthCount: { fontSize: 11 },
  mediaRow: { flexDirection: 'row', marginBottom: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl }, emptyTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' }, emptyText: { marginTop: spacing.sm, fontSize: 12, textAlign: 'center' },
  viewer: { flex: 1, backgroundColor: '#101411' }, viewerTop: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: '#00000066' },
  viewerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#FFFFFF22' }, viewerButtonText: { color: '#FFFFFF', fontSize: 30, lineHeight: 34, fontWeight: '300' }, viewerCaption: { flex: 1 }, viewerDate: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' }, viewerDescription: { marginTop: 2, color: '#FFFFFFB8', fontSize: 11 },
  openEntry: { position: 'absolute', alignSelf: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radii.pill, backgroundColor: '#FFFFFFE8' }, openEntryText: { color: colors.text, fontSize: 12, fontWeight: '700' },
});
