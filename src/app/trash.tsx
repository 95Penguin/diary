import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { cleanupExpiredTrash, listDeletedEntrySummaries, permanentlyDeleteEntry, restoreEntry, type DeletedEntrySummary } from '@/database/journal-repository';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { formatFullDate } from '@/utils/date';
import { deleteJournalImage } from '@/utils/image-storage';
import { useAppPreferences } from '@/preferences/app-preferences';
import { cleanupExpiredTimeCapsules, listDeletedTimeCapsules, permanentlyDeleteTimeCapsule, restoreTimeCapsule, type DeletedTimeCapsule } from '@/database/time-capsule-repository';
import { AppDialog } from '@/components/app-dialog';

const DAY = 24 * 60 * 60 * 1000;

export default function TrashScreen() {
  const db = useSQLiteContext();
  const { readingBodyStyle, readingFontFamily, readingTheme } = useAppPreferences();
  const [entries, setEntries] = useState<DeletedEntrySummary[]>([]);
  const [capsules, setCapsules] = useState<DeletedTimeCapsule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DeletedEntrySummary | null>(null);
  const [pendingCapsuleDelete, setPendingCapsuleDelete] = useState<DeletedTimeCapsule | null>(null);
  const [toast, setToast] = useState('');
  const [openedAt] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [nextEntries, nextCapsules] = await Promise.all([listDeletedEntrySummaries(db), listDeletedTimeCapsules(db)]);
      setEntries(nextEntries); setCapsules(nextCapsules);
      void Promise.all([cleanupExpiredTrash(db), cleanupExpiredTimeCapsules(db)]).then(([expiredImages, expiredCapsuleMedia]) => [...expiredImages, ...expiredCapsuleMedia].forEach(deleteJournalImage)).catch(() => undefined);
    } catch { setLoadError(true); }
    finally { setLoading(false); }
  }, [db]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function notify(message: string) {
    setToast(message);
    setTimeout(() => setToast(''), 1600);
  }

  async function restore(item: DeletedEntrySummary) {
    if (workingId) return; setWorkingId(item.id);
    try { await restoreEntry(db, item.id); await load(); notify('已恢复到时间轴'); }
    catch { notify('恢复失败，请稍后重试'); }
    finally { setWorkingId(null); }
  }

  async function removeForever() {
    if (!pendingDelete || workingId) return; const id = pendingDelete.id; setWorkingId(id);
    try { const imageUris = await permanentlyDeleteEntry(db, id); imageUris.forEach(deleteJournalImage); setPendingDelete(null); await load(); notify('已永久删除'); }
    catch { notify('删除失败，请稍后重试'); }
    finally { setWorkingId(null); }
  }

  async function restoreCapsule(item: DeletedTimeCapsule) { if (workingId) return; setWorkingId(item.id); try { await restoreTimeCapsule(db, item.id); await load(); notify('时间胶囊已恢复'); } catch { notify('恢复失败，请稍后重试'); } finally { setWorkingId(null); } }
  async function removeCapsuleForever() { if (!pendingCapsuleDelete || workingId) return; const id = pendingCapsuleDelete.id; setWorkingId(id); try { const uris = await permanentlyDeleteTimeCapsule(db, id); uris.forEach(deleteJournalImage); setPendingCapsuleDelete(null); await load(); notify('时间胶囊已永久删除'); } catch { notify('删除失败，请稍后重试'); } finally { setWorkingId(null); } }

  return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}>
      <Pressable accessibilityLabel="返回" hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable>
      <Text style={[styles.title, { color: readingTheme.text }]}>回收站</Text><View style={styles.headerSpace} />
    </View>
    {toast ? <View style={styles.toast}><Text style={styles.toastText}>{toast}</Text></View> : null}
    {loading && !entries.length && !capsules.length ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : loadError ? <View style={styles.failure}><Text style={[styles.failureTitle, { color: readingTheme.text }]}>回收站暂时没有加载出来</Text><Text style={[styles.failureText, { color: readingTheme.secondary }]}>内容仍保存在本机，请稍后重试。</Text><Pressable onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>重新加载</Text></Pressable></View> : <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <Text style={[styles.note, { color: readingTheme.secondary }]}>记录将在移入回收站 30 天后自动清理</Text>
      {!loading && !entries.length && !capsules.length ? <View style={styles.empty}><Text style={[styles.emptyTitle, { color: readingTheme.text }]}>回收站是空的</Text><Text style={[styles.emptyText, { color: readingTheme.secondary }]}>删除的记录和时间胶囊会在这里保留 30 天。</Text></View> : null}
      {capsules.length ? <Text style={[styles.groupTitle, { color: readingTheme.text }]}>时间胶囊</Text> : null}
      {capsules.map((capsule) => { const days = Math.max(1, Math.ceil((new Date(capsule.deletedAt).getTime() + 30 * DAY - openedAt) / DAY)); return <View key={capsule.id} style={[styles.card, { backgroundColor: readingTheme.surface }]}><Text style={styles.date}>时间胶囊</Text><Text numberOfLines={2} style={[styles.content, { color: readingTheme.text, fontFamily: fonts.serif }]}>{capsule.title}</Text><View style={styles.cardFooter}><Text style={[styles.remaining, { color: readingTheme.secondary }]}>还剩 {days} 天</Text><View style={styles.actions}><Pressable onPress={() => setPendingCapsuleDelete(capsule)}><Text style={styles.delete}>永久删除</Text></Pressable><Pressable onPress={() => void restoreCapsule(capsule)} style={styles.restoreButton}><Text style={styles.restoreText}>恢复</Text></Pressable></View></View></View>; })}
      {entries.length ? <Text style={[styles.groupTitle, { color: readingTheme.text }]}>普通记录</Text> : null}
      {entries.map((entry) => {
        const days = Math.max(1, Math.ceil((new Date(entry.deletedAt).getTime() + 30 * DAY - openedAt) / DAY));
        return <View key={entry.id} style={[styles.card, { backgroundColor: readingTheme.surface }]}>
          <Text style={styles.date}>{formatFullDate(entry.occurredAt)}</Text>
          <Text numberOfLines={3} style={[styles.content, { color: readingBodyStyle.color, fontFamily: readingFontFamily, lineHeight: 22 * readingBodyStyle.lineHeightMultiplier, letterSpacing: readingBodyStyle.letterSpacing }]}>{entry.content}</Text>
          <View style={styles.cardFooter}>
            <Text style={[styles.remaining, { color: readingTheme.secondary }]}>还剩 {days} 天</Text>
            <View style={styles.actions}><Pressable accessibilityLabel="永久删除这条记录" hitSlop={8} onPress={() => setPendingDelete(entry)}><Text style={styles.delete}>永久删除</Text></Pressable><Pressable accessibilityLabel="恢复这条记录" onPress={() => void restore(entry)} style={styles.restoreButton}><Text style={styles.restoreText}>恢复</Text></Pressable></View>
          </View>
        </View>;
      })}
    </ScrollView>}
    <AppDialog visible={Boolean(pendingDelete)} title="永久删除这条记录？" message="删除后无法恢复。" onClose={() => setPendingDelete(null)} actions={[{ label: '取消', onPress: () => setPendingDelete(null) }, { label: '永久删除', tone: 'danger', onPress: removeForever }]} />
    <AppDialog visible={Boolean(pendingCapsuleDelete)} title="永久删除这枚时间胶囊？" message="原文、媒体和所有回应都将无法恢复。" onClose={() => setPendingCapsuleDelete(null)} actions={[{ label: '取消', onPress: () => setPendingCapsuleDelete(null) }, { label: '永久删除', tone: 'danger', onPress: removeCapsuleForever }]} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { color: colors.primary, fontSize: 13 }, title: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, headerSpace: { width: 42 },
  scroll: { padding: spacing.xl, paddingBottom: spacing.xxxl }, note: { marginBottom: spacing.md, fontSize: 10, textAlign: 'center' },
  groupTitle: { marginTop: spacing.md, marginBottom: spacing.sm, fontFamily: fonts.serif, fontSize: 14, fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 100 }, emptyTitle: { fontFamily: fonts.serif, fontSize: 18 }, emptyText: { marginTop: spacing.sm, fontSize: 11 },
  card: { marginBottom: spacing.md, padding: spacing.lg, borderRadius: radii.lg },
  date: { color: colors.primary, fontSize: 10, fontWeight: '700' }, content: { marginTop: spacing.sm, fontSize: 14, lineHeight: 22 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg }, remaining: { fontSize: 10 }, actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  delete: { color: colors.danger, fontSize: 11 }, restoreButton: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.primary }, restoreText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  toast: { position: 'absolute', zIndex: 10, top: 62, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.text }, toastText: { color: '#FFFFFF', fontSize: 11 },
  loader: { flex: 1 }, failure: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl }, failureTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' }, failureText: { marginTop: spacing.sm, fontSize: 11, textAlign: 'center' }, retry: { marginTop: spacing.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.primary }, retryText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
});
