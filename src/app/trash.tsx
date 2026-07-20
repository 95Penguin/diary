import { useCallback, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { cleanupExpiredTrash, listDeletedEntries, permanentlyDeleteEntry, restoreEntry } from '@/database/journal-repository';
import type { DeletedEntry } from '@/domain/journal';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { formatFullDate } from '@/utils/date';
import { deleteJournalImage } from '@/utils/image-storage';

const DAY = 24 * 60 * 60 * 1000;

export default function TrashScreen() {
  const db = useSQLiteContext();
  const [entries, setEntries] = useState<DeletedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<DeletedEntry | null>(null);
  const [toast, setToast] = useState('');
  const [openedAt] = useState(() => Date.now());

  const load = useCallback(async () => {
    const expiredImages = await cleanupExpiredTrash(db);
    expiredImages.forEach(deleteJournalImage);
    setEntries(await listDeletedEntries(db));
    setLoading(false);
  }, [db]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function notify(message: string) {
    setToast(message);
    setTimeout(() => setToast(''), 1600);
  }

  async function restore(item: DeletedEntry) {
    await restoreEntry(db, item.id);
    await load();
    notify('已恢复到时间轴');
  }

  async function removeForever() {
    if (!pendingDelete) return;
    const imageUris = await permanentlyDeleteEntry(db, pendingDelete.id);
    imageUris.forEach(deleteJournalImage);
    setPendingDelete(null);
    await load();
    notify('已永久删除');
  }

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <Pressable hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable>
      <Text style={styles.title}>回收站</Text><View style={styles.headerSpace} />
    </View>
    {toast ? <View style={styles.toast}><Text style={styles.toastText}>{toast}</Text></View> : null}
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <Text style={styles.note}>记录将在删除 30 天后自动清理</Text>
      {!loading && !entries.length ? <View style={styles.empty}><Text style={styles.emptyTitle}>回收站是空的</Text><Text style={styles.emptyText}>删除的记录会暂时留在这里。</Text></View> : null}
      {entries.map((entry) => {
        const days = Math.max(1, Math.ceil((new Date(entry.deletedAt).getTime() + 30 * DAY - openedAt) / DAY));
        return <View key={entry.id} style={styles.card}>
          <Text style={styles.date}>{formatFullDate(entry.occurredAt)}</Text>
          <Text numberOfLines={3} style={styles.content}>{entry.content}</Text>
          <View style={styles.cardFooter}>
            <Text style={styles.remaining}>还剩 {days} 天</Text>
            <View style={styles.actions}><Pressable hitSlop={8} onPress={() => setPendingDelete(entry)}><Text style={styles.delete}>永久删除</Text></Pressable><Pressable onPress={() => void restore(entry)} style={styles.restoreButton}><Text style={styles.restoreText}>恢复</Text></Pressable></View>
          </View>
        </View>;
      })}
    </ScrollView>
    <Modal visible={Boolean(pendingDelete)} transparent animationType="fade" onRequestClose={() => setPendingDelete(null)}>
      <Pressable onPress={() => setPendingDelete(null)} style={styles.overlay}>
        <Pressable onPress={(event) => event.stopPropagation()} style={styles.confirmCard}>
          <Text style={styles.confirmTitle}>永久删除这条记录？</Text>
          <Text style={styles.confirmText}>删除后无法恢复</Text>
          <View style={styles.confirmActions}><Pressable onPress={() => setPendingDelete(null)} style={styles.confirmButton}><Text style={styles.cancelText}>取消</Text></Pressable><Pressable onPress={() => void removeForever()} style={[styles.confirmButton, styles.dangerButton]}><Text style={styles.deleteText}>删除</Text></Pressable></View>
        </Pressable>
      </Pressable>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  back: { color: colors.primary, fontSize: 13 }, title: { color: colors.text, fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, headerSpace: { width: 42 },
  scroll: { padding: spacing.xl, paddingBottom: spacing.xxxl }, note: { marginBottom: spacing.md, color: colors.textFaint, fontSize: 10, textAlign: 'center' },
  empty: { alignItems: 'center', paddingTop: 100 }, emptyTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 18 }, emptyText: { marginTop: spacing.sm, color: colors.textFaint, fontSize: 11 },
  card: { marginBottom: spacing.md, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surfaceMuted },
  date: { color: colors.primary, fontSize: 10, fontWeight: '700' }, content: { marginTop: spacing.sm, color: colors.text, fontFamily: fonts.serif, fontSize: 14, lineHeight: 22 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg }, remaining: { color: colors.textFaint, fontSize: 10 }, actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  delete: { color: colors.danger, fontSize: 11 }, restoreButton: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.primary }, restoreText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  toast: { position: 'absolute', zIndex: 10, top: 62, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.text }, toastText: { color: '#FFFFFF', fontSize: 11 },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.overlay }, confirmCard: { width: '100%', maxWidth: 300, padding: spacing.xl, borderRadius: radii.lg, backgroundColor: colors.background },
  confirmTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 18, fontWeight: '600', textAlign: 'center' }, confirmText: { marginTop: spacing.sm, color: colors.textFaint, fontSize: 11, textAlign: 'center' },
  confirmActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl }, confirmButton: { flex: 1, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.surfaceMuted }, dangerButton: { backgroundColor: '#F8E9E7' }, cancelText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' }, deleteText: { color: colors.danger, fontSize: 12, fontWeight: '700' },
});
