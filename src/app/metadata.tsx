import { useCallback, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppDialog } from '@/components/app-dialog';
import {
  addMetadataItem,
  listLocationDuplicateSuggestions,
  listMetadataUsage,
  removeLocationEverywhere,
  removeTagEverywhere,
  renameLocationEverywhere,
  renameTagEverywhere,
  toggleMetadataPinned,
  type MetadataUsage,
  type MetadataUsageItem,
} from '@/database/journal-repository';
import type { LocationDuplicateSuggestion } from '@/utils/location-duplicates';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

type MetadataKind = 'tag' | 'location';
type PendingItem = { kind: MetadataKind; item: MetadataUsageItem };
type PendingEdit = { kind: MetadataKind; item: MetadataUsageItem | null };
const EMPTY_USAGE: MetadataUsage = { tags: [], locations: [] };

export default function MetadataScreen() {
  const db = useSQLiteContext();
  const { readingTheme } = useAppPreferences();
  const [usage, setUsage] = useState(EMPTY_USAGE);
  const [editing, setEditing] = useState<PendingEdit | null>(null);
  const [deleting, setDeleting] = useState<PendingItem | null>(null);
  const [editValue, setEditValue] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<LocationDuplicateSuggestion[]>([]);
  const [merging, setMerging] = useState<{ suggestion: LocationDuplicateSuggestion; keep: string } | null>(null);

  const load = useCallback(async () => {
    const [nextUsage, nextDuplicates] = await Promise.all([
      listMetadataUsage(db),
      listLocationDuplicateSuggestions(db),
    ]);
    setUsage(nextUsage);
    setDuplicates(nextDuplicates);
  }, [db]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function beginRename(kind: MetadataKind, item: MetadataUsageItem) {
    setEditValue(item.value);
    setEditing({ kind, item });
  }

  function beginAdd(kind: MetadataKind) {
    setEditValue('');
    setEditing({ kind, item: null });
  }

  async function saveRename() {
    if (!editing || !editValue.trim()) return;
    if (!editing.item) await addMetadataItem(db, editing.kind, editValue);
    else if (editing.kind === 'tag') await renameTagEverywhere(db, editing.item.value, editValue);
    else await renameLocationEverywhere(db, editing.item.value, editValue);
    setEditing(null);
    await load();
  }

  async function togglePinned(kind: MetadataKind, item: MetadataUsageItem) {
    try {
      await toggleMetadataPinned(db, kind, item.value);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '暂时无法置顶');
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    if (deleting.kind === 'tag') await removeTagEverywhere(db, deleting.item.value);
    else await removeLocationEverywhere(db, deleting.item.value);
    setDeleting(null);
    await load();
  }

  async function confirmMerge() {
    if (!merging) return;
    const { suggestion, keep } = merging;
    const remove = suggestion.first.name === keep ? suggestion.second.name : suggestion.first.name;
    await renameLocationEverywhere(db, remove, keep);
    setMerging(null);
    await load();
  }

  return <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}>
      <Pressable hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable>
      <Text style={[styles.title, { color: readingTheme.text }]}>标签与地点</Text>
      <View style={styles.headerSpace} />
    </View>
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <MetadataSection
        title="标签"
        emptyText="记录时添加的标签会出现在这里"
        items={usage.tags}
        prefix="#"
        maxPinned={4}
        onAdd={() => beginAdd('tag')}
        onRename={(item) => beginRename('tag', item)}
        onTogglePinned={(item) => void togglePinned('tag', item)}
        onDelete={(item) => setDeleting({ kind: 'tag', item })}
      />
      {duplicates.length ? <View style={styles.duplicateSection}>
        <View style={styles.duplicateHeading}><Text style={[styles.sectionTitle, { color: readingTheme.text }]}>疑似重复地点</Text><Text style={[styles.sectionCount, { color: readingTheme.secondary }]}>本地检测 · {duplicates.length} 组</Text></View>
        <Text style={[styles.duplicateHint, { color: readingTheme.secondary }]}>只有确认后才会合并。坐标和记录正文不会删除。</Text>
        {duplicates.map((suggestion) => <View key={`${suggestion.first.name}|${suggestion.second.name}`} style={[styles.duplicateCard, { backgroundColor: readingTheme.surface }]}>
          <View style={styles.duplicateNames}><Text numberOfLines={1} style={[styles.duplicateName, { color: readingTheme.text }]}>{suggestion.first.name} · {suggestion.first.count} 条</Text><Text style={styles.duplicateSwap}>⇄</Text><Text numberOfLines={1} style={[styles.duplicateName, { color: readingTheme.text }]}>{suggestion.second.name} · {suggestion.second.count} 条</Text></View>
          <Text style={[styles.duplicateReason, { color: readingTheme.secondary }]}>{suggestion.reason} · 相距约 {suggestion.distanceMeters < 1000 ? `${suggestion.distanceMeters} 米` : `${(suggestion.distanceMeters / 1000).toFixed(1)} 公里`}</Text>
          <View style={styles.duplicateActions}><Pressable onPress={() => setMerging({ suggestion, keep: suggestion.first.name })}><Text style={styles.mergeAction}>保留“{suggestion.first.name}”</Text></Pressable><Pressable onPress={() => setMerging({ suggestion, keep: suggestion.second.name })}><Text style={styles.mergeAction}>保留“{suggestion.second.name}”</Text></Pressable></View>
        </View>)}
      </View> : null}
      <MetadataSection
        title="地点"
        emptyText="使用过的地点会出现在这里；重命名可设置别名或合并同名地点"
        items={usage.locations}
        prefix="⌖ "
        maxPinned={4}
        onAdd={() => beginAdd('location')}
        onRename={(item) => beginRename('location', item)}
        onTogglePinned={(item) => void togglePinned('location', item)}
        onDelete={(item) => setDeleting({ kind: 'location', item })}
      />
    </ScrollView>

    <Modal visible={Boolean(editing)} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
      <Pressable onPress={() => setEditing(null)} style={styles.overlay}>
        <Pressable onPress={(event) => event.stopPropagation()} style={[styles.editorCard, { backgroundColor: readingTheme.background }]}>
          <Text style={[styles.editorTitle, { color: readingTheme.text }]}>{editing?.item ? editing.kind === 'location' ? '设置地点别名 / 合并' : '重命名标签' : '新增'}{editing?.item ? '' : editing?.kind === 'tag' ? '标签' : '地点'}</Text>
          <TextInput autoFocus maxLength={editing?.kind === 'tag' ? 12 : 100} value={editValue} onChangeText={setEditValue} onSubmitEditing={() => void saveRename()} returnKeyType="done" placeholderTextColor={readingTheme.secondary} style={[styles.input, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} />
          <Text style={[styles.mergeHint, { color: readingTheme.secondary }]}>{editing?.kind === 'location' ? '输入“学校”等别名；如果名称已经存在，会把记录自动合并到该地点。坐标不会被删除。' : '如果名称已经存在，会自动合并。'}</Text>
          <View style={styles.editorActions}>
            <Pressable onPress={() => setEditing(null)}><Text style={[styles.cancel, { color: readingTheme.secondary }]}>取消</Text></Pressable>
            <Pressable disabled={!editValue.trim()} onPress={() => void saveRename()}><Text style={[styles.save, !editValue.trim() && styles.disabled]}>保存</Text></Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
    <AppDialog
      visible={Boolean(deleting)}
      title={`移除${deleting?.kind === 'tag' ? '标签' : '地点'}？`}
      message={deleting?.kind === 'tag'
        ? `“#${deleting.item.value}”会从 ${deleting.item.count} 条记录中移除，记录正文不会改变。`
        : `“${deleting?.item.value ?? ''}”会从 ${deleting?.item.count ?? 0} 条记录中移除，记录正文不会改变。`}
      onClose={() => setDeleting(null)}
      actions={[
        { label: '取消', onPress: () => setDeleting(null) },
        { label: '移除', tone: 'danger', onPress: confirmDelete },
      ]}
    />
    <AppDialog visible={Boolean(notice)} title="无法置顶" message={notice ?? ''} onClose={() => setNotice(null)} actions={[{ label: '知道了', tone: 'primary', onPress: () => setNotice(null) }]} />
    <AppDialog visible={Boolean(merging)} title="合并这两个地点？" message={merging ? `将把“${merging.suggestion.first.name === merging.keep ? merging.suggestion.second.name : merging.suggestion.first.name}”合并到“${merging.keep}”。相关记录以后会统一显示为“${merging.keep}”。` : ''} onClose={() => setMerging(null)} actions={[{ label: '取消', onPress: () => setMerging(null) }, { label: '确认合并', tone: 'primary', onPress: confirmMerge }]} />
  </SafeAreaView>;
}

function MetadataSection({ title, emptyText, items, prefix, maxPinned, onAdd, onRename, onTogglePinned, onDelete }: {
  title: string;
  emptyText: string;
  items: MetadataUsageItem[];
  prefix: string;
  maxPinned: number;
  onAdd: () => void;
  onRename: (item: MetadataUsageItem) => void;
  onTogglePinned: (item: MetadataUsageItem) => void;
  onDelete: (item: MetadataUsageItem) => void;
}) {
  const { readingTheme } = useAppPreferences();
  return <View>
    <View style={styles.sectionHeading}>
      <View><Text style={[styles.sectionTitle, { color: readingTheme.text }]}>{title}</Text><Text style={[styles.sectionCount, { color: readingTheme.secondary }]}>最多置顶 {maxPinned} 个 · 共 {items.length} 个</Text></View>
      <Pressable onPress={onAdd} style={[styles.addButton, { backgroundColor: readingTheme.surface }]}><Text style={styles.addText}>＋ 新增</Text></Pressable>
    </View>
    <View style={[styles.card, { backgroundColor: readingTheme.surface }]}>
      {items.length ? items.map((item) => <View key={item.value} style={[styles.itemRow, { borderBottomColor: readingTheme.border }]}>
        <Pressable accessibilityLabel={`重命名${item.value}`} onPress={() => onRename(item)} style={styles.itemMain}>
          <Text numberOfLines={1} style={[styles.itemName, { color: readingTheme.text }]}>{prefix}{item.value}</Text>
          {item.address && item.address !== item.value ? <Text numberOfLines={1} style={[styles.itemAddress, { color: readingTheme.secondary }]}>{item.address}</Text> : null}
          <Text style={[styles.itemCount, { color: readingTheme.secondary }]}>{item.count} 条记录</Text>
        </Pressable>
        <Pressable accessibilityLabel={item.pinned ? `取消置顶${item.value}` : `置顶${item.value}`} hitSlop={8} onPress={() => onTogglePinned(item)}><Text style={[styles.pin, item.pinned && styles.pinActive]}>{item.pinned ? '★' : '☆'}</Text></Pressable>
        <Pressable accessibilityLabel={`移除${item.value}`} hitSlop={8} onPress={() => onDelete(item)}><Text style={[styles.remove, { color: readingTheme.secondary }]}>×</Text></Pressable>
      </View>) : <Text style={[styles.empty, { color: readingTheme.secondary }]}>{emptyText}</Text>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { color: colors.primary, fontSize: 13 }, title: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, headerSpace: { width: 42 },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, marginBottom: spacing.sm },
  sectionTitle: { fontFamily: fonts.serif, fontSize: 15, fontWeight: '600' }, sectionCount: { marginTop: 2, fontSize: 11 },
  duplicateSection: { marginTop: spacing.md }, duplicateHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }, duplicateHint: { marginTop: 3, marginBottom: spacing.sm, fontSize: 11, lineHeight: 17 },
  duplicateCard: { marginBottom: spacing.sm, padding: spacing.md, borderRadius: radii.md }, duplicateNames: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  duplicateName: { flex: 1, fontSize: 12, fontWeight: '700' }, duplicateSwap: { color: colors.primary, fontSize: 13 }, duplicateReason: { marginTop: spacing.xs, fontSize: 11 },
  duplicateActions: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.md }, mergeAction: { minHeight: 36, color: colors.primary, fontSize: 11, fontWeight: '700' },
  addButton: { minHeight: 34, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.pill }, addText: { color: colors.primary, fontSize: 10, fontWeight: '700' },
  card: { overflow: 'hidden', borderRadius: radii.md },
  itemRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  itemMain: { flex: 1, minWidth: 0, paddingVertical: spacing.sm }, itemName: { fontSize: 12, fontWeight: '600' }, itemAddress: { marginTop: 2, fontSize: 11 }, itemCount: { marginTop: 2, fontSize: 11 },
  pin: { minWidth: 44, minHeight: 44, paddingLeft: spacing.md, color: colors.textFaint, fontSize: 18, lineHeight: 44 }, pinActive: { color: colors.primary }, remove: { minWidth: 44, minHeight: 44, paddingLeft: spacing.md, fontSize: 20, lineHeight: 44 }, empty: { padding: spacing.lg, fontSize: 12, textAlign: 'center' },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.overlay },
  editorCard: { width: '100%', maxWidth: 300, padding: spacing.xl, borderRadius: radii.lg },
  editorTitle: { marginBottom: spacing.md, fontFamily: fonts.serif, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  input: { height: 44, paddingHorizontal: spacing.md, borderRadius: radii.md, fontSize: 13 },
  mergeHint: { marginTop: spacing.sm, fontSize: 11, textAlign: 'center' },
  editorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xxl, marginTop: spacing.xl },
  cancel: { fontSize: 12 }, save: { color: colors.primary, fontSize: 12, fontWeight: '700' }, disabled: { opacity: 0.35 },
});
