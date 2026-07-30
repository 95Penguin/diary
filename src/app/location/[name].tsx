import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';

import { MediaThumbnail } from '@/components/media-view';
import { LocationPickerModal } from '@/components/location-picker-modal';
import { AppDialog } from '@/components/app-dialog';
import { showAppDialog } from '@/components/app-dialog-host';
import { clearCoordinatesForLocation, getLocationPageDetail, renameLocationEverywhere, updateLocationCoordinates, updateLocationPreferences, type LocationCategory, type LocationPageDetail } from '@/database/journal-repository';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { applyLocationPrivacy, type CoordinatePrivacyChoice } from '@/utils/location-privacy';

function formatDay(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value));
}
const CATEGORIES: LocationCategory[] = ['家', '学校', '工作', '旅行', '常去', '想再去'];

export default function LocationDetailScreen() {
  const db = useSQLiteContext();
  const { preferences, readingTheme, readingFontFamily } = useAppPreferences();
  const { name } = useLocalSearchParams<{ name: string }>();
  const locationName = typeof name === 'string' ? name : '';
  const [detail, setDetail] = useState<LocationPageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pendingCoordinate, setPendingCoordinate] = useState<{ address: string; latitude: number; longitude: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDetail(await getLocationPageDetail(db, locationName));
    } finally {
      setLoading(false);
    }
  }, [db, locationName]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const stats = useMemo(() => {
    if (!detail?.entries.length) return null;
    const ascending = [...detail.entries].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    return {
      visits: detail.entries.length,
      days: new Set(detail.entries.map((entry) => entry.occurredAt.slice(0, 10))).size,
      first: ascending[0].occurredAt,
      latest: ascending.at(-1)!.occurredAt,
    };
  }, [detail]);
  const media = useMemo(() => detail?.entries.flatMap((entry) =>
    entry.images.map((item) => ({ entryId: entry.id, item }))) ?? [], [detail]);

  async function saveAlias() {
    const next = editValue.trim();
    if (!detail || !next || next === detail.name) {
      setEditing(false);
      return;
    }
    await renameLocationEverywhere(db, detail.name, next);
    setEditing(false);
    router.replace(`/location/${encodeURIComponent(next)}` as Href);
  }

  async function toggleFavorite() {
    if (!detail) return;
    const favorite = !detail.favorite;
    setDetail({ ...detail, favorite });
    await updateLocationPreferences(db, detail.name, { favorite });
  }

  async function chooseCategory(category: LocationCategory) {
    if (!detail) return;
    const next = detail.category === category ? null : category;
    setDetail({ ...detail, category: next });
    await updateLocationPreferences(db, detail.name, { category: next });
  }

  async function confirmCoordinateUpdate() {
    if (!detail || !pendingCoordinate) return;
    let choice: CoordinatePrivacyChoice = 'precise';
    if (preferences.locationPrivacyMode === 'ask') {
      setPendingCoordinate(null);
      choice = (await showAppDialog({
        title: '怎样保存这个地点？',
        message: '该规则会同步应用到所有同名记录。',
        actions: [
          { label: '只存名称', value: 'nameOnly' },
          { label: '约 1 公里', value: 'approximate' },
          { label: '精确坐标', value: 'precise', tone: 'primary' },
        ],
      }) ?? 'nameOnly') as CoordinatePrivacyChoice;
    }
    const coordinates = applyLocationPrivacy(
      pendingCoordinate.latitude, pendingCoordinate.longitude, preferences.locationPrivacyMode, choice,
    );
    if (coordinates.latitude == null || coordinates.longitude == null) {
      await clearCoordinatesForLocation(db, detail.name);
    } else {
      await updateLocationCoordinates(db, detail.name, {
        ...pendingCoordinate, latitude: coordinates.latitude, longitude: coordinates.longitude,
      });
    }
    setPendingCoordinate(null);
    await load();
  }

  if (loading) return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}><ActivityIndicator style={styles.loader} color={colors.primary} /></SafeAreaView>;
  if (!detail || !stats) return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}><Pressable hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable><Text style={[styles.headerTitle, { color: readingTheme.text }]}>地点详情</Text><View style={styles.headerSpace} /></View>
    <View style={styles.empty}><Text style={[styles.emptyTitle, { color: readingTheme.text }]}>没有找到这个地点</Text><Text style={[styles.emptyText, { color: readingTheme.secondary }]}>地点可能已被重命名或合并。</Text></View>
  </SafeAreaView>;

  return <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}>
      <Pressable hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable>
      <Text style={[styles.headerTitle, { color: readingTheme.text }]}>地点详情</Text>
      <Pressable hitSlop={10} onPress={() => { setEditValue(detail.name); setEditing(true); }}><Text style={styles.edit}>整理</Text></Pressable>
    </View>
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <View style={styles.nameRow}><Text style={[styles.name, { color: readingTheme.text }]}>{detail.name}</Text><Pressable accessibilityLabel={detail.favorite ? '取消收藏地点' : '收藏地点'} onPress={() => void toggleFavorite()} style={[styles.favorite, { backgroundColor: readingTheme.surface }]}><Text style={styles.favoriteText}>{detail.favorite ? '★ 已收藏' : '☆ 收藏'}</Text></Pressable></View>
        <Text selectable style={[styles.address, { color: readingTheme.secondary }]}>{detail.address || `${detail.latitude.toFixed(5)}, ${detail.longitude.toFixed(5)}`}</Text>
        <Pressable onPress={() => setPickerVisible(true)} style={[styles.correctLocation, { backgroundColor: readingTheme.surface }]}><Text style={styles.correctLocationText}>⌖ 修正地点位置</Text><Text style={[styles.correctLocationHint, { color: readingTheme.secondary }]}>同步更新 {detail.entries.length} 条同名记录</Text></Pressable>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories}>{CATEGORIES.map((item) => <Pressable key={item} onPress={() => void chooseCategory(item)} style={[styles.category, { backgroundColor: detail.category === item ? colors.primary : readingTheme.surface }]}><Text style={[styles.categoryText, detail.category === item && styles.categoryTextActive]}>{item}</Text></Pressable>)}</ScrollView>
      </View>
      <View style={[styles.stats, { backgroundColor: readingTheme.surface }]}>
        <View style={styles.stat}><Text style={styles.statValue}>{stats.visits}</Text><Text style={[styles.statLabel, { color: readingTheme.secondary }]}>到访次数</Text></View>
        <View style={styles.stat}><Text style={styles.statValue}>{stats.days}</Text><Text style={[styles.statLabel, { color: readingTheme.secondary }]}>到访天数</Text></View>
        <View style={styles.stat}><Text style={styles.statValue}>{formatDay(stats.first)}</Text><Text style={[styles.statLabel, { color: readingTheme.secondary }]}>初次到访</Text></View>
        <View style={styles.stat}><Text style={styles.statValue}>{formatDay(stats.latest)}</Text><Text style={[styles.statLabel, { color: readingTheme.secondary }]}>最近到访</Text></View>
      </View>

      {media.length ? <View style={styles.section}>
        <View style={styles.sectionHeading}><Text style={[styles.sectionTitle, { color: readingTheme.text }]}>这里的照片</Text><Text style={[styles.sectionCount, { color: readingTheme.secondary }]}>{media.length} 张</Text></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gallery}>
          {media.map(({ entryId, item }) => <Pressable key={item.id} onPress={() => router.push({ pathname: '/entry/[id]', params: { id: entryId } })}><MediaThumbnail media={item} style={styles.photo} /></Pressable>)}
        </ScrollView>
      </View> : null}

      <View style={styles.section}>
        <View style={styles.sectionHeading}><Text style={[styles.sectionTitle, { color: readingTheme.text }]}>在这里留下的时光</Text><Text style={[styles.sectionCount, { color: readingTheme.secondary }]}>{detail.entries.length} 条</Text></View>
        <View style={[styles.entries, { borderColor: readingTheme.border }]}>
          {detail.entries.map((entry, index) => <Pressable key={entry.id} onPress={() => router.push({ pathname: '/entry/[id]', params: { id: entry.id } })} style={[styles.entry, index > 0 && { borderTopColor: readingTheme.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
            <View style={styles.timeline}><Text style={styles.dot}>•</Text><Text style={styles.date}>{formatDay(entry.occurredAt)}</Text></View>
            <Text numberOfLines={3} style={[styles.content, { color: readingTheme.text, fontFamily: readingFontFamily }]}>{entry.content || '一条没有文字的记录'}</Text>
            <Text style={styles.arrow}>›</Text>
          </Pressable>)}
        </View>
      </View>
    </ScrollView>

    <Modal visible={editing} transparent animationType="fade" onRequestClose={() => setEditing(false)}>
      <Pressable onPress={() => setEditing(false)} style={styles.overlay}>
        <Pressable onPress={(event) => event.stopPropagation()} style={[styles.editor, { backgroundColor: readingTheme.background }]}>
          <Text style={[styles.editorTitle, { color: readingTheme.text }]}>设置地点别名 / 合并</Text>
          <TextInput autoFocus maxLength={100} value={editValue} onChangeText={setEditValue} onSubmitEditing={() => void saveAlias()} returnKeyType="done" placeholder="例如：学校、家" placeholderTextColor={readingTheme.secondary} style={[styles.input, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} />
          <Text style={[styles.hint, { color: readingTheme.secondary }]}>输入更简短的别名；如果该名称已经存在，会把相关记录合并到同一地点。</Text>
          <View style={styles.actions}><Pressable onPress={() => setEditing(false)}><Text style={[styles.cancel, { color: readingTheme.secondary }]}>取消</Text></Pressable><Pressable disabled={!editValue.trim()} onPress={() => void saveAlias()}><Text style={[styles.save, !editValue.trim() && styles.disabled]}>保存</Text></Pressable></View>
        </Pressable>
      </Pressable>
    </Modal>
    {pickerVisible ? <LocationPickerModal visible name={detail.name} latitude={detail.latitude} longitude={detail.longitude} accuracy={null} onClose={() => setPickerVisible(false)} onApply={(value) => { setPickerVisible(false); setPendingCoordinate({ address: value.address, latitude: value.latitude, longitude: value.longitude }); }} /> : null}
    <AppDialog visible={Boolean(pendingCoordinate)} title="更新这个地点的位置？" message={pendingCoordinate ? `将把“${detail.name}”的 ${detail.entries.length} 条记录统一移动到新坐标。地点分类、收藏和记录正文不会改变。` : ''} onClose={() => setPendingCoordinate(null)} actions={[{ label: '取消', onPress: () => setPendingCoordinate(null) }, { label: '确认更新', tone: 'primary', onPress: confirmCoordinateUpdate }]} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, loader: { marginTop: 120 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { color: colors.primary, fontSize: 13 }, headerTitle: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, headerSpace: { width: 42 }, edit: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  scroll: { paddingBottom: spacing.xxxl }, hero: { paddingHorizontal: spacing.xl, paddingTop: spacing.xxl, paddingBottom: spacing.lg },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, name: { flex: 1, fontFamily: fonts.serif, fontSize: 24, lineHeight: 34, fontWeight: '600' }, address: { marginTop: spacing.xs, fontSize: 11, lineHeight: 18 },
  favorite: { paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radii.pill }, favoriteText: { color: colors.primary, fontSize: 9, fontWeight: '700' },
  correctLocation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.md }, correctLocationText: { color: colors.primary, fontSize: 10, fontWeight: '700' }, correctLocationHint: { fontSize: 8 },
  categories: { gap: spacing.xs, paddingTop: spacing.sm }, category: { paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radii.pill }, categoryText: { color: colors.primary, fontSize: 9, fontWeight: '600' }, categoryTextActive: { color: '#FFFFFF' },
  stats: { flexDirection: 'row', marginHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radii.lg },
  stat: { flex: 1, alignItems: 'center', paddingHorizontal: 2 }, statValue: { color: colors.primary, fontSize: 10, fontWeight: '700', textAlign: 'center' }, statLabel: { marginTop: 4, fontSize: 8 },
  section: { marginTop: spacing.xxl }, sectionHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: spacing.xl, marginBottom: spacing.md },
  sectionTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' }, sectionCount: { fontSize: 10 },
  gallery: { paddingHorizontal: spacing.xl, gap: spacing.sm }, photo: { width: 112, height: 112, borderRadius: radii.md },
  entries: { marginHorizontal: spacing.xl, paddingHorizontal: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg },
  entry: { minHeight: 86, justifyContent: 'center', paddingVertical: spacing.md, paddingRight: spacing.xl },
  timeline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs }, dot: { color: colors.primary, fontSize: 15 }, date: { color: colors.primary, fontSize: 10, fontWeight: '700' },
  content: { marginTop: spacing.xs, fontSize: 14, lineHeight: 22 }, arrow: { position: 'absolute', right: 0, color: colors.primary, fontSize: 19 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' }, emptyTitle: { fontFamily: fonts.serif, fontSize: 18 }, emptyText: { marginTop: spacing.sm, fontSize: 11 },
  overlay: { flex: 1, justifyContent: 'center', padding: spacing.xl, backgroundColor: '#00000055' }, editor: { padding: spacing.xl, borderRadius: radii.lg },
  editorTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' }, input: { height: 46, marginTop: spacing.lg, paddingHorizontal: spacing.md, borderRadius: radii.md, fontSize: 14 },
  hint: { marginTop: spacing.sm, fontSize: 10, lineHeight: 17 }, actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.xl, marginTop: spacing.xl },
  cancel: { fontSize: 12 }, save: { color: colors.primary, fontSize: 12, fontWeight: '700' }, disabled: { opacity: 0.35 },
});
