import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';

import { deleteDraft, listDrafts } from '@/database/journal-repository';
import type { Draft } from '@/domain/journal';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { formatShortDateTime } from '@/utils/date';
import { deleteJournalImage } from '@/utils/image-storage';
import { useAppPreferences } from '@/preferences/app-preferences';
import { AppDialog } from '@/components/app-dialog';

export default function DraftsScreen() {
  const db = useSQLiteContext();
  const { readingTheme, readingFontFamily, fontScale } = useAppPreferences();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [pendingDelete, setPendingDelete] = useState<Draft | null>(null);
  const load = useCallback(async () => setDrafts(await listDrafts(db)), [db]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function confirmDelete(draft: Draft) {
    setPendingDelete(draft);
  }

  return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]} edges={['top', 'bottom']}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}><Pressable accessibilityLabel="返回" hitSlop={12} onPress={() => router.canGoBack() ? router.back() : router.replace('/')}><Text style={styles.back}>‹ 返回</Text></Pressable><Text style={[styles.title, { color: readingTheme.text }]}>草稿箱</Text><Pressable accessibilityLabel="新建草稿" hitSlop={12} onPress={() => router.push('/compose')}><Text style={styles.newDraft}>＋ 新建</Text></Pressable></View>
    {drafts.length ? <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
      <Text style={styles.count}>{drafts.length} 份草稿 · 按最近编辑排序</Text>
      {drafts.map((draft) => <Pressable accessibilityRole="button" accessibilityLabel={`继续编辑草稿：${draft.content || '图片草稿'}`} key={draft.id} onPress={() => router.push({ pathname: '/compose', params: { draft: draft.id } })} style={({ pressed }) => [styles.card, { backgroundColor: readingTheme.surface }, pressed && styles.pressed]}>
        {draft.images[0] ? <Image source={{ uri: draft.images[0].uri }} resizeMode="cover" style={styles.thumbnail} /> : null}
        <View style={styles.cardBody}><Text numberOfLines={3} style={[styles.content, { color: readingTheme.text, fontFamily: readingFontFamily, fontSize: 14 * fontScale, lineHeight: 21 * fontScale }]}>{draft.content.trim() || '图片草稿'}</Text><View style={styles.meta}><Text style={[styles.updated, { color: readingTheme.secondary }]}>编辑于 {formatShortDateTime(draft.updatedAt)}</Text><View style={styles.details}>{draft.mood ? <Text style={[styles.detail, { color: readingTheme.secondary }]}>{draft.mood}</Text> : null}{draft.weather ? <Text style={[styles.detail, { color: readingTheme.secondary }]}>{draft.weather}</Text> : null}{draft.locationName ? <Text numberOfLines={1} style={[styles.detail, { color: readingTheme.secondary }]}>⌖ {draft.locationName}</Text> : null}{draft.images.length ? <Text style={[styles.detail, { color: readingTheme.secondary }]}>{draft.images.length} 张图片</Text> : null}</View></View></View>
        <Pressable accessibilityLabel="删除草稿" hitSlop={10} onPress={(event) => { event.stopPropagation(); confirmDelete(draft); }} style={styles.delete}><Text style={styles.deleteText}>删除</Text></Pressable>
      </Pressable>)}
    </ScrollView> : <View style={styles.empty}><Text style={styles.emptySymbol}>✎</Text><Text style={styles.emptyTitle}>草稿箱是空的</Text><Text style={styles.emptyText}>未发布的记录会自动保存在这里。</Text><Pressable onPress={() => router.push('/compose')} style={styles.composeButton}><Text style={styles.composeText}>记录此刻</Text></Pressable></View>}
    <AppDialog visible={Boolean(pendingDelete)} title="删除这份草稿？" message="草稿中的文字和图片会一起删除。" onClose={() => setPendingDelete(null)} actions={[{ label: '取消', onPress: () => setPendingDelete(null) }, { label: '删除', tone: 'danger', onPress: async () => { if (!pendingDelete) return; const uris = await deleteDraft(db, pendingDelete.id); uris.forEach(deleteJournalImage); setPendingDelete(null); await load(); } }]} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, back: { color: colors.primary, fontSize: 13 }, title: { color: colors.text, fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, newDraft: { color: colors.primary, fontSize: 12, fontWeight: '600' },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl }, count: { paddingVertical: spacing.md, color: colors.textSecondary, fontSize: 10 }, card: { position: 'relative', flexDirection: 'row', gap: spacing.md, minHeight: 104, marginBottom: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface }, pressed: { opacity: 0.68 }, thumbnail: { width: 76, height: 76, borderRadius: radii.sm, backgroundColor: colors.surfaceMuted }, cardBody: { flex: 1, paddingRight: 36 }, content: { color: colors.text, fontFamily: fonts.serif, fontSize: 14, lineHeight: 21 }, meta: { marginTop: 'auto' }, updated: { color: colors.textFaint, fontSize: 9 }, details: { flexDirection: 'row', gap: spacing.sm, marginTop: 3 }, detail: { color: colors.textSecondary, fontSize: 9 }, delete: { position: 'absolute', top: spacing.md, right: spacing.md, padding: spacing.xs }, deleteText: { color: colors.danger, fontSize: 10 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl }, emptySymbol: { color: colors.primary, fontSize: 42 }, emptyTitle: { marginTop: spacing.md, color: colors.text, fontFamily: fonts.serif, fontSize: 18 }, emptyText: { marginTop: spacing.sm, color: colors.textFaint, fontSize: 11 }, composeButton: { marginTop: spacing.xl, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.primary }, composeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});
