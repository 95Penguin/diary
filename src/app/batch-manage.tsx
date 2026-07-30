import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppDialog } from '@/components/app-dialog';
import { batchAddEntryTag, batchDeleteEntries, batchRemoveEntryTag, batchSetEntryFavorite, batchSetEntryLocation, listEntries } from '@/database/journal-repository';
import type { Entry } from '@/domain/journal';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { formatShortDateTime } from '@/utils/date';
import { recordAppError } from '@/utils/app-error-log';

type Editor = 'addTag' | 'removeTag' | 'location' | null;

export default function BatchManageScreen() {
  const db = useSQLiteContext();
  const { preferences, readingTheme } = useAppPreferences();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editor, setEditor] = useState<Editor>(null);
  const [value, setValue] = useState('');
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const [deleteConfirmationVisible, setDeleteConfirmationVisible] = useState(false);
  const [coordinateChoiceVisible, setCoordinateChoiceVisible] = useState(false);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return entries ?? [];
    return (entries ?? []).filter((entry) => [entry.content, entry.locationName, ...entry.tags].filter(Boolean).some((item) => item!.toLocaleLowerCase().includes(keyword)));
  }, [entries, query]);

  async function reload() { setEntries(await listEntries(db)); setSelected(new Set()); }
  useEffect(() => {
    let active = true;
    void listEntries(db).then((items) => { if (active) setEntries(items); });
    return () => { active = false; };
  }, [db]);
  function toggle(id: string) { setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  const ids = [...selected];

  async function apply(action: () => Promise<void>, success: string) {
    if (!ids.length) return;
    setWorking(true);
    try { await action(); await reload(); setEditor(null); setValue(''); setNotice({ title: '已完成', message: success }); }
    catch (error) { void recordAppError('batch-manage', error); setNotice({ title: '操作失败', message: '记录暂时无法批量修改，请稍后重试。' }); }
    finally { setWorking(false); }
  }

  function confirmDelete() {
    setDeleteConfirmationVisible(true);
  }

  function applyLocation(coordinateMode: 'precise' | 'approximate' | 'nameOnly') {
    setCoordinateChoiceVisible(false);
    return apply(() => batchSetEntryLocation(db, ids, value, coordinateMode), '批量修改已保存。');
  }

  async function saveBatchEditor() {
    if (editor === 'addTag') return apply(() => batchAddEntryTag(db, ids, value), '批量修改已保存。');
    if (editor === 'removeTag') return apply(() => batchRemoveEntryTag(db, ids, value), '批量修改已保存。');
    if (preferences.locationPrivacyMode === 'ask') {
      setCoordinateChoiceVisible(true);
      return;
    }
    return applyLocation(preferences.locationPrivacyMode);
  }

  return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}><Pressable hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable><Text style={[styles.title, { color: readingTheme.text }]}>批量管理</Text><Pressable disabled={!filtered.length} onPress={() => setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map((entry) => entry.id)))}><Text style={styles.selectAll}>{selected.size === filtered.length && filtered.length ? '取消全选' : '全选'}</Text></Pressable></View>
    <View style={styles.searchWrap}><TextInput value={query} onChangeText={setQuery} placeholder="搜索正文、标签或地点" placeholderTextColor={readingTheme.secondary} style={[styles.search, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} /></View>
    <View style={[styles.actionBar, { borderColor: readingTheme.border }]}><Text style={[styles.selectedCount, { color: readingTheme.secondary }]}>已选 {selected.size} 条</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actions}>
      <Action label="+ 标签" disabled={!ids.length} onPress={() => setEditor('addTag')} /><Action label="− 标签" disabled={!ids.length} onPress={() => setEditor('removeTag')} /><Action label="改地点" disabled={!ids.length} onPress={() => setEditor('location')} /><Action label="收藏" disabled={!ids.length} onPress={() => void apply(() => batchSetEntryFavorite(db, ids, true), '已加入收藏。')} /><Action label="取消收藏" disabled={!ids.length} onPress={() => void apply(() => batchSetEntryFavorite(db, ids, false), '已取消收藏。')} /><Action label="删除" danger disabled={!ids.length} onPress={confirmDelete} />
    </ScrollView></View>
    {!entries ? <ActivityIndicator style={styles.loader} color={colors.primary} /> : <ScrollView contentContainerStyle={styles.list}>{filtered.map((entry) => {
      const active = selected.has(entry.id);
      return <Pressable key={entry.id} onPress={() => toggle(entry.id)} style={[styles.item, { backgroundColor: readingTheme.surface }, active && styles.itemActive]}><View style={[styles.checkbox, active && styles.checkboxActive]}>{active ? <Text style={styles.check}>✓</Text> : null}</View><View style={styles.itemBody}><Text numberOfLines={2} style={[styles.itemText, { color: readingTheme.text }]}>{entry.content}</Text><Text numberOfLines={1} style={[styles.meta, { color: readingTheme.secondary }]}>{formatShortDateTime(entry.occurredAt)}{entry.locationName ? ` · ${entry.locationName}` : ''}{entry.tags.length ? ` · #${entry.tags.join(' #')}` : ''}</Text></View></Pressable>;
    })}</ScrollView>}
    <Modal visible={editor !== null} transparent animationType="fade" onRequestClose={() => setEditor(null)}><Pressable onPress={() => setEditor(null)} style={styles.overlay}><Pressable onPress={(event) => event.stopPropagation()} style={[styles.modal, { backgroundColor: readingTheme.background }]}><Text style={[styles.modalTitle, { color: readingTheme.text }]}>{editor === 'addTag' ? '添加标签' : editor === 'removeTag' ? '移除标签' : '修改地点'}</Text><TextInput autoFocus value={value} onChangeText={setValue} placeholder={editor === 'location' ? '地点名称，留空可清除' : '标签名称'} placeholderTextColor={readingTheme.secondary} style={[styles.input, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} /><View style={styles.modalActions}><Pressable onPress={() => setEditor(null)}><Text style={[styles.cancel, { color: readingTheme.secondary }]}>取消</Text></Pressable><Pressable disabled={working || (editor !== 'location' && !value.trim())} onPress={() => void saveBatchEditor()}><Text style={styles.confirm}>保存</Text></Pressable></View></Pressable></Pressable></Modal>
    <AppDialog visible={deleteConfirmationVisible} title="移入回收站？" message={`将 ${ids.length} 条记录移入回收站，可在 30 天内恢复。`} onClose={() => setDeleteConfirmationVisible(false)} actions={[{ label: '取消', onPress: () => setDeleteConfirmationVisible(false) }, { label: '移入', tone: 'danger', onPress: () => { setDeleteConfirmationVisible(false); void apply(() => batchDeleteEntries(db, ids), '记录已移入回收站。'); } }]} />
    <AppDialog visible={coordinateChoiceVisible} title="地点坐标怎样处理？" message="如果该地点已有坐标，可选择批量记录保存的精度。" onClose={() => setCoordinateChoiceVisible(false)} actions={[{ label: '只存名称', onPress: () => void applyLocation('nameOnly') }, { label: '约 1 公里', onPress: () => void applyLocation('approximate') }, { label: '精确坐标', tone: 'primary', onPress: () => void applyLocation('precise') }]} />
    <AppDialog visible={Boolean(notice)} title={notice?.title ?? ''} message={notice?.message} onClose={() => setNotice(null)} actions={[{ label: '知道了', tone: 'primary', onPress: () => setNotice(null) }]} />
  </SafeAreaView>;
}

function Action({ label, disabled, danger, onPress }: { label: string; disabled: boolean; danger?: boolean; onPress: () => void }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.action, disabled && styles.disabled]}><Text style={[styles.actionText, danger && styles.danger]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, header: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth }, back: { color: colors.primary, fontSize: 13 }, title: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' }, selectAll: { color: colors.primary, fontSize: 12 },
  searchWrap: { padding: spacing.md }, search: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radii.pill, fontSize: 12 }, actionBar: { borderBottomWidth: StyleSheet.hairlineWidth }, selectedCount: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xs, fontSize: 10 }, actions: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.xs }, action: { minHeight: 34, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.primarySoft }, actionText: { color: colors.primary, fontSize: 10, fontWeight: '700' }, danger: { color: '#B4564B' }, disabled: { opacity: 0.35 },
  loader: { marginTop: 60 }, list: { padding: spacing.md, paddingBottom: spacing.xxxl, gap: spacing.sm }, item: { minHeight: 70, flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radii.md }, itemActive: { borderWidth: 1.5, borderColor: colors.primary }, checkbox: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md, borderRadius: 11, borderWidth: 1, borderColor: colors.textFaint }, checkboxActive: { borderColor: colors.primary, backgroundColor: colors.primary }, check: { color: '#fff', fontSize: 12, fontWeight: '700' }, itemBody: { flex: 1 }, itemText: { fontFamily: fonts.serif, fontSize: 13, lineHeight: 20 }, meta: { marginTop: 5, fontSize: 9 },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.overlay }, modal: { width: '100%', maxWidth: 320, padding: spacing.xl, borderRadius: radii.lg }, modalTitle: { fontFamily: fonts.serif, fontSize: 17, textAlign: 'center' }, input: { minHeight: 44, marginTop: spacing.lg, paddingHorizontal: spacing.md, borderRadius: radii.md }, modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xxl, marginTop: spacing.xl }, cancel: { fontSize: 12 }, confirm: { color: colors.primary, fontSize: 12, fontWeight: '700' },
});
