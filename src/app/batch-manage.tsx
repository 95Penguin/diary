import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, InteractionManager, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppDialog } from '@/components/app-dialog';
import { CompactPillButton, PrimaryButton } from '@/components/ui/buttons';
import { batchAddEntryTag, batchDeleteEntries, batchRemoveEntryTag, batchSetEntryFavorite, batchSetEntryLocation, listEntryManagementSummaries, type EntryManagementSummary } from '@/database/journal-repository';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { formatShortDateTime } from '@/utils/date';
import { recordAppError } from '@/utils/app-error-log';

type Editor = 'addTag' | 'removeTag' | 'location' | null;

export default function BatchManageScreen() {
  const db = useSQLiteContext();
  const { preferences, readingTheme } = useAppPreferences();
  const [entries, setEntries] = useState<EntryManagementSummary[] | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editor, setEditor] = useState<Editor>(null);
  const [value, setValue] = useState('');
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const [deleteConfirmationVisible, setDeleteConfirmationVisible] = useState(false);
  const [coordinateChoiceVisible, setCoordinateChoiceVisible] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return entries ?? [];
    return (entries ?? []).filter((entry) => [entry.content, entry.locationName, ...entry.tags].filter(Boolean).some((item) => item!.toLocaleLowerCase().includes(keyword)));
  }, [entries, query]);

  async function reload() { setEntries(await listEntryManagementSummaries(db)); setSelected(new Set()); }
  function closeEditor() { setEditor(null); setCoordinateChoiceVisible(false); setValue(''); }
  function openEditor(next: Exclude<Editor, null>) { setNotice(null); setCoordinateChoiceVisible(false); setValue(''); setEditor(next); }
  useEffect(() => {
    let active = true;
    const task = InteractionManager.runAfterInteractions(() => {
      void listEntryManagementSummaries(db).then((items) => { if (active) setEntries(items); }).catch((error) => { void recordAppError('batch-manage.load', error); if (active) { setEntries([]); setNotice({ title: '读取失败', message: '记录仍保存在本机，请返回后重新尝试。' }); } });
    });
    return () => { active = false; task.cancel(); };
  }, [db, reloadKey]);
  function toggle(id: string) { if (working) return; setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  const ids = [...selected];

  async function apply(action: () => Promise<void>, success: string) {
    if (!ids.length) return;
    setWorking(true);
    try { await action(); }
    catch (error) {
      void recordAppError('batch-manage.write', error);
      closeEditor();
      setNotice({ title: '操作失败', message: '记录暂时无法批量修改，请稍后重试。' });
      setWorking(false);
      return;
    }
    closeEditor();
    try {
      await reload();
      setNotice({ title: '已完成', message: success });
    } catch (error) {
      void recordAppError('batch-manage.refresh', error);
      setSelected(new Set());
      setNotice({ title: '修改已保存', message: '列表暂时没有刷新，请重新读取后查看最新结果。' });
    } finally { setWorking(false); }
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
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}><Pressable accessibilityLabel="返回" hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable><Text style={[styles.title, { color: readingTheme.text }]}>批量管理</Text><Pressable accessibilityLabel={selected.size === filtered.length && filtered.length ? '取消全选' : `全选 ${filtered.length} 条记录`} disabled={!filtered.length} onPress={() => setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map((entry) => entry.id)))}><Text style={styles.selectAll}>{selected.size === filtered.length && filtered.length ? '取消全选' : '全选'}</Text></Pressable></View>
    <View style={styles.searchWrap}><TextInput accessibilityLabel="筛选需要批量管理的记录" value={query} onChangeText={(next) => { setQuery(next); setSelected(new Set()); }} placeholder="搜索正文、标签或地点" placeholderTextColor={readingTheme.secondary} style={[styles.search, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} /></View>
    <View style={[styles.actionBar, { backgroundColor: readingTheme.surface, borderBottomColor: readingTheme.border }]}><Text style={[styles.selectedCount, { color: readingTheme.secondary }]}>已选 {selected.size} 条</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actions}>
      <Action label="+ 标签" backgroundColor={readingTheme.surface} disabled={!ids.length || working} onPress={() => openEditor('addTag')} /><Action label="− 标签" backgroundColor={readingTheme.surface} disabled={!ids.length || working} onPress={() => openEditor('removeTag')} /><Action label="改地点" backgroundColor={readingTheme.surface} disabled={!ids.length || working} onPress={() => openEditor('location')} /><Action label="收藏" backgroundColor={readingTheme.surface} disabled={!ids.length || working} onPress={() => void apply(() => batchSetEntryFavorite(db, ids, true), '已加入收藏。')} /><Action label="取消收藏" backgroundColor={readingTheme.surface} disabled={!ids.length || working} onPress={() => void apply(() => batchSetEntryFavorite(db, ids, false), '已取消收藏。')} /><Action label="删除" backgroundColor={readingTheme.surface} danger disabled={!ids.length || working} onPress={confirmDelete} />
    </ScrollView></View>
    {notice ? <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: readingTheme.surface }]}><View style={styles.noticeCopy}><Text style={[styles.noticeTitle, { color: readingTheme.text }]}>{notice.title}</Text><Text style={[styles.noticeMessage, { color: readingTheme.secondary }]}>{notice.message}</Text></View>{notice.title === '读取失败' || notice.title === '修改已保存' ? <Pressable onPress={() => { setNotice(null); setEntries(null); setReloadKey((current) => current + 1); }} style={styles.noticeAction}><Text style={styles.noticeActionText}>重新读取</Text></Pressable> : <Pressable onPress={() => setNotice(null)} style={styles.noticeAction}><Text style={styles.noticeActionText}>知道了</Text></Pressable>}</View> : null}
    {!entries ? <ActivityIndicator style={styles.loader} color={colors.primary} /> : <FlatList data={filtered} keyExtractor={(entry) => entry.id} contentContainerStyle={styles.list} initialNumToRender={12} maxToRenderPerBatch={10} windowSize={7} renderItem={({ item: entry }) => {
      const active = selected.has(entry.id);
      return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: active }} accessibilityLabel={`${active ? '取消选择' : '选择'}记录：${entry.content || formatShortDateTime(entry.occurredAt)}`} onPress={() => toggle(entry.id)} style={[styles.item, { backgroundColor: readingTheme.surface }, active && styles.itemActive]}><View style={[styles.checkbox, { borderColor: readingTheme.secondary }, active && styles.checkboxActive]}>{active ? <Text style={styles.check}>✓</Text> : null}</View><View style={styles.itemBody}><Text numberOfLines={2} style={[styles.itemText, { color: readingTheme.text }]}>{entry.content}</Text><Text numberOfLines={1} style={[styles.meta, { color: readingTheme.secondary }]}>{formatShortDateTime(entry.occurredAt)}{entry.locationName ? ` · ${entry.locationName}` : ''}{entry.tags.length ? ` · #${entry.tags.join(' #')}` : ''}</Text></View></Pressable>;
    }} ListEmptyComponent={<View style={styles.empty}><Text style={[styles.emptyText, { color: readingTheme.secondary }]}>{query.trim() ? '没有匹配的记录' : '还没有可以批量管理的记录'}</Text></View>} />}
    <Modal visible={editor !== null} transparent animationType="fade" onRequestClose={() => coordinateChoiceVisible ? setCoordinateChoiceVisible(false) : closeEditor()}><Pressable onPress={() => coordinateChoiceVisible ? setCoordinateChoiceVisible(false) : closeEditor()} style={styles.overlay}><Pressable onPress={(event) => event.stopPropagation()} style={[styles.modal, { backgroundColor: readingTheme.background }]}>{coordinateChoiceVisible ? <><Text style={[styles.modalTitle, { color: readingTheme.text }]}>地点坐标怎样处理？</Text><Text style={[styles.coordinateMessage, { color: readingTheme.secondary }]}>如果该地点已有坐标，可选择批量记录保存的精度。</Text><View style={styles.coordinateActions}><PrimaryButton disabled={working} onPress={() => void applyLocation('nameOnly')}><Text style={styles.confirm}>只存名称</Text></PrimaryButton><PrimaryButton disabled={working} onPress={() => void applyLocation('approximate')}><Text style={styles.confirm}>约 1 公里</Text></PrimaryButton><PrimaryButton disabled={working} onPress={() => void applyLocation('precise')}><Text style={styles.confirm}>精确坐标</Text></PrimaryButton><Pressable disabled={working} onPress={() => setCoordinateChoiceVisible(false)} style={styles.sheetCancel}><Text style={[styles.cancel, { color: readingTheme.secondary }]}>返回修改</Text></Pressable></View></> : <><Text style={[styles.modalTitle, { color: readingTheme.text }]}>{editor === 'addTag' ? '添加标签' : editor === 'removeTag' ? '移除标签' : '修改地点'}</Text><TextInput autoFocus value={value} onChangeText={setValue} placeholder={editor === 'location' ? '地点名称，留空可清除' : '标签名称'} placeholderTextColor={readingTheme.secondary} style={[styles.input, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} /><View style={styles.modalActions}><Pressable onPress={closeEditor} style={styles.editorCancel}><Text style={[styles.cancel, { color: readingTheme.secondary }]}>取消</Text></Pressable><PrimaryButton disabled={working || (editor !== 'location' && !value.trim())} onPress={() => void saveBatchEditor()} style={styles.editorSave}><Text style={styles.confirm}>保存</Text></PrimaryButton></View></>}</Pressable></Pressable></Modal>
    <AppDialog visible={deleteConfirmationVisible} title="移入回收站？" message={`将 ${ids.length} 条记录移入回收站，可在 30 天内恢复。`} onClose={() => setDeleteConfirmationVisible(false)} actions={[{ label: '取消', onPress: () => setDeleteConfirmationVisible(false) }, { label: '移入', tone: 'danger', onPress: () => { setDeleteConfirmationVisible(false); void apply(() => batchDeleteEntries(db, ids), '记录已移入回收站。'); } }]} />
  </SafeAreaView>;
}

function Action({ label, backgroundColor, disabled, danger, onPress }: { label: string; backgroundColor: string; disabled: boolean; danger?: boolean; onPress: () => void }) {
  return <CompactPillButton disabled={disabled} onPress={onPress} style={[styles.action, { backgroundColor }]}><Text style={[styles.actionText, danger && styles.danger]}>{label}</Text></CompactPillButton>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, header: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth }, back: { color: colors.primary, fontSize: 13 }, title: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' }, selectAll: { color: colors.primary, fontSize: 12 },
  searchWrap: { padding: spacing.md }, search: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radii.pill, fontSize: 12 }, actionBar: { borderBottomWidth: StyleSheet.hairlineWidth }, selectedCount: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xs, fontSize: 10 }, actions: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.xs }, action: { paddingHorizontal: spacing.sm }, actionText: { color: colors.primary, fontSize: 10, fontWeight: '700' }, danger: { color: colors.danger },
  loader: { marginTop: 60 }, list: { padding: spacing.md, paddingBottom: spacing.xxxl, gap: spacing.sm }, item: { minHeight: 62, flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radii.md }, itemActive: { borderWidth: 1.5, borderColor: colors.primary }, checkbox: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md, borderRadius: 11, borderWidth: 1 }, checkboxActive: { borderColor: colors.primary, backgroundColor: colors.primary }, check: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' }, itemBody: { flex: 1 }, itemText: { fontFamily: fonts.serif, fontSize: 13, lineHeight: 20 }, meta: { marginTop: 4, fontSize: 9 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginHorizontal: spacing.md, marginTop: spacing.sm, padding: spacing.md, borderRadius: radii.md }, noticeCopy: { flex: 1 }, noticeTitle: { fontSize: 11, fontWeight: '700' }, noticeMessage: { marginTop: 2, fontSize: 9, lineHeight: 15 }, noticeAction: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.sm }, noticeActionText: { color: colors.primary, fontSize: 10, fontWeight: '700' }, empty: { paddingVertical: 64, alignItems: 'center' }, emptyText: { fontSize: 11 },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.overlay }, modal: { width: '100%', maxWidth: 320, padding: spacing.xl, borderRadius: radii.lg }, modalTitle: { fontFamily: fonts.serif, fontSize: 17, textAlign: 'center' }, input: { minHeight: 44, marginTop: spacing.lg, paddingHorizontal: spacing.md, borderRadius: radii.md }, modalActions: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.md, marginTop: spacing.xl }, editorCancel: { minHeight: 42, justifyContent: 'center', paddingHorizontal: spacing.md }, editorSave: { minWidth: 92 }, cancel: { fontSize: 12 }, confirm: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' }, coordinateMessage: { marginTop: spacing.sm, fontSize: 11, lineHeight: 18, textAlign: 'center' }, coordinateActions: { gap: spacing.sm, marginTop: spacing.xl }, sheetCancel: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
});
