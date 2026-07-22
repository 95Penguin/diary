import { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';

import { getEntry, listEntryVersions, restoreEntryVersion } from '@/database/journal-repository';
import type { Entry, EntryVersion } from '@/domain/journal';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { formatFullDate, formatShortDateTime } from '@/utils/date';
import { useAppPreferences } from '@/preferences/app-preferences';
import { AppDialog } from '@/components/app-dialog';

function changedFields(version: EntryVersion, newer: Entry | EntryVersion | null) {
  if (!newer) return ['历史版本'];
  const fields: string[] = [];
  if (version.content !== newer.content) fields.push('正文');
  if (version.occurredAt !== newer.occurredAt) fields.push('时间');
  if (version.mood !== newer.mood) fields.push('心情');
  if (version.weather !== newer.weather) fields.push('天气');
  if (version.locationName !== newer.locationName) fields.push('地点');
  if (JSON.stringify(version.tags) !== JSON.stringify(newer.tags)) fields.push('标签');
  return fields.length ? fields : ['其他信息'];
}

export default function EntryHistoryScreen() {
  const db = useSQLiteContext();
  const { readingTheme, readingFontFamily, fontScale } = useAppPreferences();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [versions, setVersions] = useState<EntryVersion[]>([]);
  const [preview, setPreview] = useState<EntryVersion | null>(null);
  const [pendingRestore, setPendingRestore] = useState<EntryVersion | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    const [current, history] = await Promise.all([getEntry(db, id), listEntryVersions(db, id)]);
    setEntry(current); setVersions(history); setLoading(false);
  }, [db, id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function restore(version: EntryVersion) {
    setPendingRestore(version);
  }

  return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]} edges={['top', 'bottom']}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}><Pressable accessibilityLabel="返回" hitSlop={12} onPress={() => router.canGoBack() ? router.back() : router.replace('/')}><Text style={styles.back}>‹ 返回</Text></Pressable><Text style={[styles.title, { color: readingTheme.text }]}>编辑历史</Text><View style={styles.space} /></View>
    {loading ? <View style={styles.center}><Text style={styles.hint}>正在读取历史…</Text></View> : !entry ? <View style={styles.center}><Text style={styles.emptyTitle}>记录不存在</Text></View> : versions.length ? <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
      <View style={[styles.notice, { backgroundColor: readingTheme.surface }]}><Text style={[styles.noticeText, { color: readingTheme.secondary }]}>保存正文、时间、心情、天气、地点和标签的历史；图片不随版本恢复。最多保留最近 50 个版本。</Text></View>
      {versions.map((version, index) => {
        const newer = index === 0 ? entry : versions[index - 1];
        const changes = changedFields(version, newer);
        return <Pressable accessibilityRole="button" key={version.id} onPress={() => setPreview(version)} style={({ pressed }) => [styles.card, { backgroundColor: readingTheme.surface }, pressed && styles.pressed]}>
          <View style={styles.cardHeader}><Text style={styles.versionTime}>{formatShortDateTime(version.createdAt)}</Text><Text style={[styles.changes, { color: readingTheme.secondary }]}>修改了 {changes.join('、')}</Text></View>
          <Text numberOfLines={3} style={[styles.content, { color: readingTheme.text, fontFamily: readingFontFamily, fontSize: 14 * fontScale, lineHeight: 21 * fontScale }]}>{version.content}</Text>
          <View style={styles.meta}>{version.mood ? <Text style={[styles.metaText, { backgroundColor: readingTheme.background, color: readingTheme.secondary }]}>{version.mood}</Text> : null}{version.weather ? <Text style={[styles.metaText, { backgroundColor: readingTheme.background, color: readingTheme.secondary }]}>{version.weather}</Text> : null}{version.locationName ? <Text numberOfLines={1} style={[styles.metaText, { backgroundColor: readingTheme.background, color: readingTheme.secondary }]}>⌖ {version.locationName}</Text> : null}</View>
        </Pressable>;
      })}
    </ScrollView> : <View style={styles.center}><Text style={styles.emptySymbol}>↶</Text><Text style={styles.emptyTitle}>还没有编辑历史</Text><Text style={styles.hint}>修改并保存记录后，旧版本会出现在这里。</Text></View>}

    <Modal visible={Boolean(preview)} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
      <Pressable onPress={() => setPreview(null)} style={styles.overlay}><Pressable onPress={(event) => event.stopPropagation()} style={[styles.previewCard, { backgroundColor: readingTheme.background }]}>
        {preview ? <><Text style={[styles.previewTitle, { color: readingTheme.text }]}>历史版本</Text><Text style={[styles.previewDate, { color: readingTheme.secondary }]}>保存于 {formatShortDateTime(preview.createdAt)} · 发生于 {formatFullDate(preview.occurredAt)}</Text><ScrollView style={styles.previewScroll} showsVerticalScrollIndicator={false}><Text style={[styles.previewContent, { color: readingTheme.text, fontFamily: readingFontFamily, fontSize: 16 * fontScale, lineHeight: 25 * fontScale }]}>{preview.content}</Text><View style={styles.previewMeta}>{preview.mood ? <Text style={[styles.metaText, { backgroundColor: readingTheme.surface, color: readingTheme.secondary }]}>{preview.mood}</Text> : null}{preview.weather ? <Text style={[styles.metaText, { backgroundColor: readingTheme.surface, color: readingTheme.secondary }]}>{preview.weather}</Text> : null}{preview.locationName ? <Text style={[styles.metaText, { backgroundColor: readingTheme.surface, color: readingTheme.secondary }]}>⌖ {preview.locationName}</Text> : null}{preview.tags.map((tag) => <Text key={tag} style={[styles.metaText, { backgroundColor: readingTheme.surface, color: readingTheme.secondary }]}>#{tag}</Text>)}</View></ScrollView><View style={styles.previewActions}><Pressable onPress={() => setPreview(null)} style={[styles.cancelButton, { backgroundColor: readingTheme.surface }]}><Text style={[styles.cancelText, { color: readingTheme.secondary }]}>取消</Text></Pressable><Pressable onPress={() => restore(preview)} style={styles.restoreButton}><Text style={styles.restoreText}>恢复此版本</Text></Pressable></View></> : null}
      </Pressable></Pressable>
    </Modal>
    <AppDialog visible={Boolean(pendingRestore)} title="恢复这个版本？" message="当前内容会先保存为一个新历史版本，你可以之后再次恢复。图片不会发生变化。" onClose={() => setPendingRestore(null)} actions={[{ label: '取消', onPress: () => setPendingRestore(null) }, { label: '恢复', tone: 'primary', onPress: async () => { if (!pendingRestore) return; const restored = await restoreEntryVersion(db, pendingRestore.id); setPendingRestore(null); if (!restored) { Alert.alert('恢复失败', '这个历史版本可能已不存在。'); return; } setPreview(null); await load(); } }]} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, back: { color: colors.primary, fontSize: 13 }, title: { color: colors.text, fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, space: { width: 42 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl }, emptySymbol: { color: colors.primary, fontSize: 42 }, emptyTitle: { marginTop: spacing.sm, color: colors.text, fontFamily: fonts.serif, fontSize: 18 }, hint: { marginTop: spacing.sm, color: colors.textFaint, fontSize: 11, textAlign: 'center' },
  list: { padding: spacing.xl, paddingBottom: spacing.xxxl }, notice: { marginBottom: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.primarySoft }, noticeText: { color: colors.textSecondary, fontSize: 10, lineHeight: 16 }, card: { marginBottom: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface }, pressed: { opacity: 0.65 }, cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }, versionTime: { color: colors.primary, fontSize: 10, fontWeight: '700' }, changes: { flexShrink: 1, color: colors.textFaint, fontSize: 9, textAlign: 'right' }, content: { marginTop: spacing.sm, color: colors.text, fontFamily: fonts.serif, fontSize: 14, lineHeight: 21 }, meta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }, metaText: { overflow: 'hidden', paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted, color: colors.textSecondary, fontSize: 9 },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.overlay }, previewCard: { width: '100%', maxWidth: 340, maxHeight: '78%', padding: spacing.xl, borderRadius: radii.lg, backgroundColor: colors.background }, previewTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 18, fontWeight: '600', textAlign: 'center' }, previewDate: { marginTop: spacing.sm, color: colors.textFaint, fontSize: 9, textAlign: 'center' }, previewScroll: { marginTop: spacing.lg }, previewContent: { color: colors.text, fontFamily: fonts.serif, fontSize: 16, lineHeight: 25 }, previewMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md }, previewActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl }, cancelButton: { flex: 1, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.surfaceMuted }, restoreButton: { flex: 1, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.primary }, cancelText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' }, restoreText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});
