import { useCallback, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { createFollowUp, deleteEntry, deleteFollowUp, getEntry, getFollowUpOrder, saveFollowUpOrder, updateFollowUp } from '@/database/journal-repository';
import type { Entry, FollowUp } from '@/domain/journal';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { formatFullDate, formatShortDateTime } from '@/utils/date';
import { deleteJournalImage } from '@/utils/image-storage';

export default function EntryDetailScreen() {
  const db = useSQLiteContext();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);
  const [followUp, setFollowUp] = useState('');
  const [sending, setSending] = useState(false);
  const [editingFollowUp, setEditingFollowUp] = useState<FollowUp | null>(null);
  const [editValue, setEditValue] = useState('');
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [entryMenuVisible, setEntryMenuVisible] = useState(false);
  const [entryMenuMode, setEntryMenuMode] = useState<'actions' | 'delete'>('actions');
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
    setEntryMenuMode('actions');
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
    Alert.alert('后续操作', undefined, [
      { text: '编辑', onPress: () => { setEditingFollowUp(item); setEditValue(item.content); } },
      { text: '删除', style: 'destructive', onPress: () => confirmDeleteFollowUp(item) },
      { text: '取消', style: 'cancel' },
    ]);
  }

  async function saveFollowUpEdit() {
    if (!editingFollowUp || !editValue.trim()) return;
    try {
      await updateFollowUp(db, editingFollowUp.id, editValue);
      setEditingFollowUp(null); setEditValue(''); await load();
    } catch { Alert.alert('保存失败', '这条后续没有保存，请稍后重试。'); }
  }

  function confirmDeleteFollowUp(item: FollowUp) {
    Alert.alert('删除这条后续？', undefined, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        try { await deleteFollowUp(db, item.id); await load(); }
        catch { Alert.alert('删除失败', '这条后续暂时无法删除，请稍后重试。'); }
      } },
    ]);
  }

  if (loading) return <SafeAreaView style={styles.safe}><View style={styles.missing}><Text style={styles.loadingText}>正在打开这一刻…</Text></View></SafeAreaView>;
  if (!entry) return <SafeAreaView style={styles.safe}><View style={styles.missing}><Text style={styles.missingTitle}>记录不存在</Text><Pressable onPress={leaveDetail}><Text style={styles.backLink}>返回时间轴</Text></Pressable></View></SafeAreaView>;

  return <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.header}><Pressable onPress={leaveDetail} hitSlop={12}><Text style={styles.back}>‹ 返回</Text></Pressable><Text style={styles.headerTitle}>这一刻</Text><Pressable onPress={openEntryMenu} hitSlop={12}><Text style={styles.menu}>•••</Text></Pressable></View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={styles.date}>{formatFullDate(entry.occurredAt)}</Text>
        <Text style={styles.content}>{entry.content}</Text>
        {entry.images.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.imageStrip}>
          {entry.images.map((image) => <Pressable key={image.id} onPress={() => setPreviewUri(image.uri)}><Image source={image.uri} contentFit="cover" style={styles.detailImage} /></Pressable>)}
        </ScrollView> : null}
        {entry.tags.length ? <View style={styles.tags}>{entry.tags.map((tag) => <View key={tag} style={styles.tag}><Text style={styles.tagText}>#{tag}</Text></View>)}</View> : null}
        {entry.createdAt !== entry.occurredAt ? <Text style={styles.created}>记录于 {formatShortDateTime(entry.createdAt)}</Text> : null}
        <View style={styles.divider} />
        <View style={styles.followUpHeading}><Text style={styles.followUpTitle}>后续</Text><View style={styles.followUpHeadingRight}><Text style={styles.count}>{entry.followUps.length} 条</Text>{entry.followUps.length > 1 ? <Pressable hitSlop={8} onPress={() => void toggleFollowUpOrder()} style={styles.orderButton}><Text style={styles.orderText}>{followUpOrder === 'asc' ? '正序' : '倒序'}⌄</Text></Pressable> : null}</View></View>
        {entry.followUps.length ? [...entry.followUps].sort((a, b) => followUpOrder === 'asc' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)).map((item) => <View key={item.id} style={styles.followUpItem}>
          <View style={styles.rail}><View style={styles.dot} /><View style={styles.line} /></View>
          <View style={styles.followUpBody}>
            <View style={styles.followUpMeta}><Text style={styles.followUpTime}>{formatShortDateTime(item.createdAt)}</Text><Pressable accessibilityLabel="后续操作" hitSlop={10} onPress={() => openFollowUpMenu(item)}><Text style={styles.followUpMenu}>•••</Text></Pressable></View>
            <Text style={styles.followUpText}>{item.content}</Text>
          </View>
        </View>) : <Text style={styles.empty}>后来发生了什么？可以随时回来补充。</Text>}
      </ScrollView>
      <View style={styles.inputBar}><TextInput maxLength={2000} value={followUp} onChangeText={setFollowUp} onSubmitEditing={() => void addFollowUp()} returnKeyType="send" placeholder="写一条后续……" placeholderTextColor={colors.textFaint} style={styles.input} /><Pressable disabled={!followUp.trim() || sending} onPress={() => void addFollowUp()}><Text style={[styles.send, (!followUp.trim() || sending) && styles.disabled]}>{sending ? '发送中' : '发送'}</Text></Pressable></View>
      <Modal visible={Boolean(editingFollowUp)} transparent animationType="fade" onRequestClose={() => setEditingFollowUp(null)}>
        <KeyboardAvoidingView style={styles.modalKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.modalOverlay}><View style={styles.modalCard}>
          <Text style={styles.modalTitle}>编辑</Text>
          <TextInput autoFocus multiline maxLength={2000} value={editValue} onChangeText={setEditValue} textAlignVertical="top" style={styles.modalInput} />
          <View style={styles.modalActions}><Pressable onPress={() => setEditingFollowUp(null)}><Text style={styles.modalCancel}>取消</Text></Pressable><Pressable disabled={!editValue.trim()} onPress={() => void saveFollowUpEdit()}><Text style={[styles.modalSave, !editValue.trim() && styles.disabled]}>保存</Text></Pressable></View>
        </View></View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={Boolean(previewUri)} transparent animationType="fade" onRequestClose={() => setPreviewUri(null)}>
        <Pressable accessibilityLabel="关闭图片" onPress={() => setPreviewUri(null)} style={styles.previewOverlay}>
          {previewUri ? <Image source={previewUri} contentFit="contain" style={styles.previewImage} /> : null}
          <Text style={styles.previewClose}>×</Text>
        </Pressable>
      </Modal>
      <Modal visible={entryMenuVisible} transparent animationType="fade" onRequestClose={() => setEntryMenuVisible(false)}>
        <Pressable onPress={() => setEntryMenuVisible(false)} style={styles.actionOverlay}>
          <Pressable onPress={(event) => event.stopPropagation()} style={styles.actionCard}>
            {entryMenuMode === 'actions' ? <>
              <Text style={styles.actionTitle}>记录操作</Text>
              <View style={styles.actionButtons}>
                <Pressable onPress={editEntry} style={({ pressed }) => [styles.actionButton, styles.actionPrimary, pressed && styles.actionPressed]}><Text style={styles.actionLabel}>编辑</Text></Pressable>
                <Pressable onPress={() => setEntryMenuMode('delete')} style={({ pressed }) => [styles.actionButton, styles.actionDanger, pressed && styles.actionPressed]}><Text style={styles.actionDangerLabel}>删除</Text></Pressable>
              </View>
              <Pressable onPress={() => setEntryMenuVisible(false)} style={styles.actionCancel}><Text style={styles.actionCancelText}>取消</Text></Pressable>
            </> : <>
              <Text style={styles.actionTitle}>删除这条记录？</Text>
              <Text style={styles.actionMessage}>记录和后续将一起删除</Text>
              <View style={styles.actionButtons}>
                <Pressable onPress={() => setEntryMenuMode('actions')} style={({ pressed }) => [styles.actionButton, pressed && styles.actionPressed]}><Text style={styles.actionCancelText}>取消</Text></Pressable>
                <Pressable onPress={() => void deleteCurrentEntry()} style={({ pressed }) => [styles.actionButton, styles.actionDanger, pressed && styles.actionPressed]}><Text style={styles.actionDangerLabel}>删除</Text></Pressable>
              </View>
            </>}
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, flex: { flex: 1 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  back: { color: colors.primary, fontSize: 13 }, headerTitle: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 24, fontWeight: '600', includeFontPadding: false }, menu: { color: colors.textSecondary, letterSpacing: 2 },
  scroll: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xl },
  date: { color: colors.primary, fontSize: 11, fontWeight: '700' }, content: { marginTop: spacing.md, color: colors.text, fontFamily: fonts.serif, fontSize: 17, lineHeight: 27, includeFontPadding: false },
  imageStrip: { gap: spacing.sm, paddingTop: spacing.md }, detailImage: { width: 112, height: 112, borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md }, tag: { paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: colors.primarySoft }, tagText: { color: colors.primary, fontSize: 10 },
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
  previewOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111111F2' }, previewImage: { width: '100%', height: '100%' }, previewClose: { position: 'absolute', top: 52, right: 24, color: '#FFFFFF', fontSize: 34, lineHeight: 38 },
  actionOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.overlay },
  actionCard: { width: '100%', maxWidth: 300, padding: spacing.xl, borderRadius: radii.lg, backgroundColor: colors.background },
  actionTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 18, lineHeight: 26, fontWeight: '600', textAlign: 'center', includeFontPadding: false },
  actionMessage: { marginTop: spacing.sm, color: colors.textFaint, fontSize: 11, textAlign: 'center' },
  actionButtons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  actionButton: { flex: 1, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  actionPrimary: { backgroundColor: colors.primarySoft }, actionDanger: { backgroundColor: '#F8E9E7' }, actionPressed: { opacity: 0.58 },
  actionLabel: { color: colors.primary, fontSize: 13, fontWeight: '700' }, actionDangerLabel: { color: colors.danger, fontSize: 13, fontWeight: '700' },
  actionCancel: { alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg }, actionCancelText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
});
