import { useCallback, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { createFollowUp, deleteEntry, deleteFollowUp, getEntry, updateFollowUp } from '@/database/journal-repository';
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

  const load = useCallback(async () => {
    if (!id) { setLoading(false); return; }
    try { setEntry(await getEntry(db, id)); }
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

  function openEntryMenu() {
    if (!entry) return;
    Alert.alert('记录操作', undefined, [
      { text: '编辑', onPress: () => router.push({ pathname: '/compose', params: { id: entry.id } }) },
      { text: '删除', style: 'destructive', onPress: confirmDeleteEntry },
      { text: '取消', style: 'cancel' },
    ]);
  }

  function confirmDeleteEntry() {
    if (!entry) return;
    Alert.alert('删除这条记录？', '记录及其所有后续会一起删除。', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        try {
          const imageUris = await deleteEntry(db, entry.id);
          imageUris.forEach(deleteJournalImage);
          router.dismissAll();
        }
        catch { Alert.alert('删除失败', '记录暂时无法删除，请稍后重试。'); }
      } },
    ]);
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
        {entry.createdAt !== entry.occurredAt ? <Text style={styles.created}>记录于 {formatShortDateTime(entry.createdAt)}</Text> : null}
        <View style={styles.divider} />
        <View style={styles.followUpHeading}><Text style={styles.followUpTitle}>后续</Text><Text style={styles.count}>{entry.followUps.length} 条</Text></View>
        {entry.followUps.length ? entry.followUps.map((item) => <View key={item.id} style={styles.followUpItem}>
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
  created: { marginTop: spacing.md, color: colors.textFaint, fontSize: 10 }, divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.lg, backgroundColor: colors.border },
  followUpHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }, followUpTitle: { fontFamily: fonts.serif, fontSize: 17, lineHeight: 26, fontWeight: '600', includeFontPadding: false }, count: { color: colors.textFaint, fontSize: 10 },
  followUpItem: { flexDirection: 'row', minHeight: 54 }, rail: { width: 20, alignItems: 'center' }, dot: { width: 8, height: 8, marginTop: 4, borderRadius: 4, borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.background }, line: { width: 1, flex: 1, marginVertical: 3, backgroundColor: colors.border },
  followUpBody: { flex: 1, paddingBottom: spacing.md }, followUpMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, followUpTime: { color: colors.textFaint, fontSize: 10 }, followUpMenu: { minWidth: 28, color: colors.textSecondary, textAlign: 'right', letterSpacing: 1 }, followUpText: { marginTop: 2, color: colors.text, fontSize: 14, lineHeight: 21 },
  empty: { color: colors.textFaint, textAlign: 'center', paddingVertical: spacing.xl, fontSize: 11 },
  inputBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.background },
  input: { flex: 1, height: 40, paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted, color: colors.text, fontSize: 13 }, send: { color: colors.primary, fontSize: 12, fontWeight: '700' }, disabled: { opacity: 0.3 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center' }, loadingText: { color: colors.textFaint, fontSize: 12 }, missingTitle: { fontFamily: fonts.serif, fontSize: 18 }, backLink: { marginTop: spacing.lg, color: colors.primary },
  modalKeyboard: { flex: 1 }, modalOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.overlay }, modalCard: { width: '100%', padding: spacing.xl, borderRadius: radii.lg, backgroundColor: colors.surface }, modalTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' },
  modalInput: { minHeight: 120, marginTop: spacing.lg, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted, color: colors.text, fontSize: 15, lineHeight: 23 }, modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xxl, marginTop: spacing.xl }, modalCancel: { color: colors.textSecondary }, modalSave: { color: colors.primary, fontWeight: '700' },
  previewOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111111F2' }, previewImage: { width: '100%', height: '100%' }, previewClose: { position: 'absolute', top: 52, right: 24, color: '#FFFFFF', fontSize: 34, lineHeight: 38 },
});
