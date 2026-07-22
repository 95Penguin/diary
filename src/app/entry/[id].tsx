import { useCallback, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { createFollowUp, deleteEntry, deleteFollowUp, getEntry, getFollowUpOrder, saveFollowUpOrder, setEntryFavorite, updateFollowUp } from '@/database/journal-repository';
import { EntryActionModal } from '@/components/entry-action-modal';
import type { Entry, FollowUp } from '@/domain/journal';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { formatFullDate, formatShortDateTime } from '@/utils/date';
import { deleteJournalImage } from '@/utils/image-storage';
import { useAppPreferences } from '@/preferences/app-preferences';
import { AppDialog } from '@/components/app-dialog';

export default function EntryDetailScreen() {
  const db = useSQLiteContext();
  const { fontScale, readingFontFamily, readingTheme } = useAppPreferences();
  const { width: viewportWidth } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);
  const [followUp, setFollowUp] = useState('');
  const [sending, setSending] = useState(false);
  const [editingFollowUp, setEditingFollowUp] = useState<FollowUp | null>(null);
  const [followUpAction, setFollowUpAction] = useState<FollowUp | null>(null);
  const [confirmingFollowUpDelete, setConfirmingFollowUpDelete] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [entryMenuVisible, setEntryMenuVisible] = useState(false);
  const [followUpOrder, setFollowUpOrder] = useState<'asc' | 'desc'>('asc');

  const load = useCallback(async () => {
    if (!id) { setLoading(false); return; }
    try {
      const [nextEntry, order] = await Promise.all([getEntry(db, id), getFollowUpOrder(db)]);
      setEntry(nextEntry);
      setFollowUpOrder(order);
    }
    finally { setLoading(false); }
  }, [db, id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function leaveDetail() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  async function toggleFavorite() {
    if (!entry) return;
    const next = !entry.favoritedAt;
    setEntry({ ...entry, favoritedAt: next ? new Date().toISOString() : null });
    try { await setEntryFavorite(db, entry.id, next); }
    catch { await load(); Alert.alert('操作失败', '收藏状态没有保存，请稍后重试。'); }
  }

  async function addFollowUp() {
    if (!entry || !followUp.trim() || sending) return;
    setSending(true);
    try { await createFollowUp(db, entry.id, followUp); setFollowUp(''); await load(); }
    catch { Alert.alert('添加失败', '后续没有保存，请稍后重试。'); }
    finally { setSending(false); }
  }

  async function toggleFollowUpOrder() {
    const next = followUpOrder === 'asc' ? 'desc' : 'asc';
    setFollowUpOrder(next);
    await saveFollowUpOrder(db, next);
  }

  function openEntryMenu() {
    if (!entry) return;
    setEntryMenuVisible(true);
  }

  function editEntry() {
    if (!entry) return;
    setEntryMenuVisible(false);
    router.push({ pathname: '/compose', params: { id: entry.id } });
  }

  async function deleteCurrentEntry() {
    if (!entry) return;
    try {
      const imageUris = await deleteEntry(db, entry.id);
      imageUris.forEach(deleteJournalImage);
      setEntryMenuVisible(false);
      router.dismissAll();
    }
    catch {
      setEntryMenuVisible(false);
      Alert.alert('删除失败', '记录暂时无法删除，请稍后重试。');
    }
  }

  function openFollowUpMenu(item: FollowUp) {
    setFollowUpAction(item);
    setConfirmingFollowUpDelete(false);
  }

  async function saveFollowUpEdit() {
    if (!editingFollowUp || !editValue.trim()) return;
    try {
      await updateFollowUp(db, editingFollowUp.id, editValue);
      setEditingFollowUp(null); setEditValue(''); await load();
    } catch { Alert.alert('保存失败', '这条后续没有保存，请稍后重试。'); }
  }

  if (loading) return <SafeAreaView style={styles.safe}><View style={styles.missing}><Text style={styles.loadingText}>正在打开这一刻…</Text></View></SafeAreaView>;
  if (!entry) return <SafeAreaView style={styles.safe}><View style={styles.missing}><Text style={styles.missingTitle}>记录不存在</Text><Pressable onPress={leaveDetail}><Text style={styles.backLink}>返回时间轴</Text></Pressable></View></SafeAreaView>;

  return <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[styles.header, { borderBottomColor: readingTheme.border }]}><Pressable accessibilityLabel="返回" onPress={leaveDetail} hitSlop={12}><Text style={styles.back}>‹ 返回</Text></Pressable><Text style={[styles.headerTitle, { color: readingTheme.text }]}>这一刻</Text><View style={styles.headerActions}><Pressable accessibilityLabel={entry.favoritedAt ? '取消收藏' : '收藏'} onPress={() => void toggleFavorite()} hitSlop={12} style={styles.favoriteButton}><SymbolView name={{ ios: entry.favoritedAt ? 'bookmark.fill' : 'bookmark', android: entry.favoritedAt ? 'bookmark' : 'bookmark_border', web: entry.favoritedAt ? 'bookmark' : 'bookmark_border' }} size={19} tintColor={entry.favoritedAt ? colors.primary : readingTheme.secondary} /></Pressable><Pressable accessibilityLabel="记录操作" onPress={openEntryMenu} hitSlop={12}><Text style={[styles.menu, { color: readingTheme.secondary }]}>•••</Text></Pressable></View></View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={styles.date}>{formatFullDate(entry.occurredAt)}</Text>
        <Text style={[styles.content, { color: readingTheme.text, fontFamily: readingFontFamily, fontSize: 17 * fontScale, lineHeight: 27 * fontScale }]}>{entry.content}</Text>
        {entry.images.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.imageStrip}>
          {entry.images.map((image, index) => <Pressable accessibilityLabel={`查看图片 ${index + 1}`} key={image.id} onPress={() => setPreviewIndex(index)}><Image source={image.uri} contentFit="cover" style={styles.detailImage} /></Pressable>)}
        </ScrollView> : null}
        {entry.mood || entry.weather || entry.locationName || entry.tags.length ? <View style={styles.metaSummary}>
          {entry.mood ? <Text style={[styles.metaItem, { backgroundColor: readingTheme.surface, color: readingTheme.secondary }]}>{entry.mood}</Text> : null}
          {entry.weather ? <Text style={[styles.metaItem, { backgroundColor: readingTheme.surface, color: readingTheme.secondary }]}>{entry.weather}</Text> : null}
          {entry.locationName ? <Text numberOfLines={1} style={[styles.metaItem, styles.locationItem, { backgroundColor: readingTheme.surface }]}>⌖ {entry.locationName}</Text> : null}
          {entry.tags.map((tag) => <Text key={tag} style={[styles.metaItem, { backgroundColor: readingTheme.surface, color: readingTheme.secondary }]}>#{tag}</Text>)}
        </View> : null}
        {entry.createdAt !== entry.occurredAt ? <Text style={[styles.created, { color: readingTheme.secondary }]}>记录于 {formatShortDateTime(entry.createdAt)}</Text> : null}
        <View style={[styles.divider, { backgroundColor: readingTheme.border }]} />
        <View style={styles.followUpHeading}><Text style={[styles.followUpTitle, { color: readingTheme.text }]}>后续</Text><View style={styles.followUpHeadingRight}><Text style={[styles.count, { color: readingTheme.secondary }]}>{entry.followUps.length} 条</Text>{entry.followUps.length > 1 ? <Pressable hitSlop={8} onPress={() => void toggleFollowUpOrder()} style={[styles.orderButton, { backgroundColor: readingTheme.surface }]}><Text style={styles.orderText}>{followUpOrder === 'asc' ? '正序' : '倒序'}⌄</Text></Pressable> : null}</View></View>
        {entry.followUps.length ? [...entry.followUps].sort((a, b) => followUpOrder === 'asc' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)).map((item) => <View key={item.id} style={styles.followUpItem}>
          <View style={styles.rail}><View style={[styles.dot, { backgroundColor: readingTheme.background }]} /><View style={[styles.line, { backgroundColor: readingTheme.border }]} /></View>
          <View style={styles.followUpBody}>
            <View style={styles.followUpMeta}><Text style={[styles.followUpTime, { color: readingTheme.secondary }]}>{formatShortDateTime(item.createdAt)}</Text><Pressable accessibilityLabel="后续操作" hitSlop={10} onPress={() => openFollowUpMenu(item)}><Text style={[styles.followUpMenu, { color: readingTheme.secondary }]}>•••</Text></Pressable></View>
            <Text style={[styles.followUpText, { color: readingTheme.text, fontFamily: readingFontFamily, fontSize: 13 * fontScale, lineHeight: 20 * fontScale }]}>{item.content}</Text>
          </View>
        </View>) : <Text style={[styles.empty, { color: readingTheme.secondary }]}>后来发生了什么？可以随时回来补充。</Text>}
      </ScrollView>
      <View style={[styles.inputBar, { backgroundColor: readingTheme.background, borderTopColor: readingTheme.border }]}><TextInput maxLength={2000} value={followUp} onChangeText={setFollowUp} onSubmitEditing={() => void addFollowUp()} returnKeyType="send" placeholder="写一条后续……" placeholderTextColor={readingTheme.secondary} style={[styles.input, { backgroundColor: readingTheme.surface, color: readingTheme.text, fontFamily: readingFontFamily }]} /><Pressable disabled={!followUp.trim() || sending} onPress={() => void addFollowUp()}><Text style={[styles.send, (!followUp.trim() || sending) && styles.disabled]}>{sending ? '发送中' : '发送'}</Text></Pressable></View>
      <Modal visible={Boolean(editingFollowUp)} transparent animationType="fade" onRequestClose={() => setEditingFollowUp(null)}>
        <KeyboardAvoidingView style={styles.modalKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.modalOverlay}><View style={[styles.modalCard, { backgroundColor: readingTheme.background }]}>
          <Text style={[styles.modalTitle, { color: readingTheme.text }]}>编辑</Text>
          <TextInput autoFocus multiline maxLength={2000} value={editValue} onChangeText={setEditValue} textAlignVertical="top" style={[styles.modalInput, { backgroundColor: readingTheme.surface, color: readingTheme.text, fontFamily: readingFontFamily }]} />
          <View style={styles.modalActions}><Pressable onPress={() => setEditingFollowUp(null)}><Text style={[styles.modalCancel, { color: readingTheme.secondary }]}>取消</Text></Pressable><Pressable disabled={!editValue.trim()} onPress={() => void saveFollowUpEdit()}><Text style={[styles.modalSave, !editValue.trim() && styles.disabled]}>保存</Text></Pressable></View>
        </View></View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={previewIndex !== null} transparent animationType="fade" onRequestClose={() => setPreviewIndex(null)}>
        <View style={styles.previewOverlay}>
          {previewIndex !== null ? <ScrollView horizontal pagingEnabled bounces={false} showsHorizontalScrollIndicator={false} style={styles.previewScroller} contentOffset={{ x: previewIndex * viewportWidth, y: 0 }} onMomentumScrollEnd={(event) => setPreviewIndex(Math.round(event.nativeEvent.contentOffset.x / viewportWidth))}>
            {entry.images.map((image, index) => <View accessibilityLabel={`图片 ${index + 1}，共 ${entry.images.length} 张`} key={image.id} style={[styles.previewPage, { width: viewportWidth }]}><Image source={image.uri} contentFit="contain" style={styles.previewImage} /></View>)}
          </ScrollView> : null}
          {previewIndex !== null && entry.images.length > 1 ? <Text style={styles.previewCount}>{previewIndex + 1} / {entry.images.length}</Text> : null}
          <Pressable accessibilityLabel="关闭图片" onPress={() => setPreviewIndex(null)} hitSlop={12} style={styles.previewCloseButton}><Text style={styles.previewClose}>×</Text></Pressable>
        </View>
      </Modal>
      <EntryActionModal visible={entryMenuVisible} onClose={() => setEntryMenuVisible(false)} onEdit={editEntry} onDelete={deleteCurrentEntry} onHistory={() => { setEntryMenuVisible(false); router.push({ pathname: '/history/[id]', params: { id: entry.id } }); }} />
      <AppDialog visible={Boolean(followUpAction)} title={confirmingFollowUpDelete ? '删除这条后续？' : '后续操作'} message={confirmingFollowUpDelete ? '删除后将无法恢复。' : undefined} onClose={() => { setFollowUpAction(null); setConfirmingFollowUpDelete(false); }} actions={confirmingFollowUpDelete ? [{ label: '取消', onPress: () => setConfirmingFollowUpDelete(false) }, { label: '删除', tone: 'danger', onPress: async () => { if (!followUpAction) return; try { await deleteFollowUp(db, followUpAction.id); setFollowUpAction(null); setConfirmingFollowUpDelete(false); await load(); } catch { Alert.alert('删除失败', '这条后续暂时无法删除，请稍后重试。'); } } }] : [{ label: '编辑', tone: 'primary', onPress: () => { if (!followUpAction) return; setEditingFollowUp(followUpAction); setEditValue(followUpAction.content); setFollowUpAction(null); } }, { label: '删除', tone: 'danger', onPress: () => setConfirmingFollowUpDelete(true) }]} />
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, flex: { flex: 1 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  back: { color: colors.primary, fontSize: 13 }, headerTitle: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 24, fontWeight: '600', includeFontPadding: false }, headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg }, favoriteButton: { width: 28, height: 36, alignItems: 'center', justifyContent: 'center' }, menu: { color: colors.textSecondary, letterSpacing: 2 },
  scroll: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xl },
  date: { color: colors.primary, fontSize: 11, fontWeight: '700' }, content: { marginTop: spacing.md, color: colors.text, fontFamily: fonts.serif, fontSize: 17, lineHeight: 27, includeFontPadding: false }, metaSummary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, marginTop: spacing.md }, metaItem: { overflow: 'hidden', paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted, color: colors.textSecondary, fontSize: 10 }, locationItem: { maxWidth: 280, color: colors.primary, backgroundColor: colors.primarySoft },
  imageStrip: { gap: spacing.sm, paddingTop: spacing.md }, detailImage: { width: 112, height: 112, borderRadius: radii.md, backgroundColor: 'transparent' },
  created: { marginTop: spacing.md, color: colors.textFaint, fontSize: 10 }, divider: { height: StyleSheet.hairlineWidth, marginTop: spacing.md, marginBottom: spacing.sm, backgroundColor: colors.border },
  followUpHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }, followUpTitle: { fontFamily: fonts.serif, fontSize: 17, lineHeight: 26, fontWeight: '600', includeFontPadding: false }, followUpHeadingRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, count: { color: colors.textFaint, fontSize: 10 },
  orderButton: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted }, orderText: { color: colors.primary, fontSize: 10 },
  followUpItem: { flexDirection: 'row', minHeight: 44 }, rail: { width: 20, alignItems: 'center' }, dot: { width: 8, height: 8, marginTop: 4, borderRadius: 4, borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.background }, line: { width: 1, flex: 1, marginVertical: 3, backgroundColor: colors.border },
  followUpBody: { flex: 1, paddingBottom: spacing.sm }, followUpMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, followUpTime: { color: colors.textFaint, fontSize: 10 }, followUpMenu: { minWidth: 28, color: colors.textSecondary, textAlign: 'right', letterSpacing: 1 }, followUpText: { marginTop: 1, color: colors.text, fontSize: 13, lineHeight: 20 },
  empty: { color: colors.textFaint, textAlign: 'center', paddingVertical: spacing.xl, fontSize: 11 },
  inputBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.background },
  input: { flex: 1, height: 40, paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted, color: colors.text, fontSize: 13 }, send: { color: colors.primary, fontSize: 12, fontWeight: '700' }, disabled: { opacity: 0.3 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center' }, loadingText: { color: colors.textFaint, fontSize: 12 }, missingTitle: { fontFamily: fonts.serif, fontSize: 18 }, backLink: { marginTop: spacing.lg, color: colors.primary },
  modalKeyboard: { flex: 1 }, modalOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.overlay }, modalCard: { width: '100%', padding: spacing.xl, borderRadius: radii.lg, backgroundColor: colors.surface }, modalTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' },
  modalInput: { minHeight: 120, marginTop: spacing.lg, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted, color: colors.text, fontSize: 15, lineHeight: 23 }, modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xxl, marginTop: spacing.xl }, modalCancel: { color: colors.textSecondary }, modalSave: { color: colors.primary, fontWeight: '700' },
  previewOverlay: { flex: 1, backgroundColor: '#111111F2' }, previewScroller: { flex: 1 }, previewPage: { flex: 1, alignItems: 'center', justifyContent: 'center' }, previewImage: { width: '100%', height: '100%' }, previewCloseButton: { position: 'absolute', top: 48, right: 20, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, previewClose: { color: '#FFFFFF', fontSize: 34, lineHeight: 38 }, previewCount: { position: 'absolute', bottom: 42, alignSelf: 'center', overflow: 'hidden', paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: '#00000080', color: '#FFFFFF', fontSize: 12 },
});
