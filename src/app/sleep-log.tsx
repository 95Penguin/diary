import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';

import { deleteSleepRecord, getLatestSleepRecords, getSleepRecordForNight, saveSleepRecord, sleepNightDate, type SleepRecord } from '@/database/sleep-repository';
import { showAppDialog } from '@/components/app-dialog-host';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { useAppPreferences } from '@/preferences/app-preferences';

function timeLabel(value: string) { return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }); }
function dateLabel(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
}
function nightLabel(value: string) { const [, month, day] = value.split('-'); return `${Number(month)}月${Number(day)}日`; }

export default function SleepLogScreen() {
  const db = useSQLiteContext();
  const { readingTheme } = useAppPreferences();
  const [records, setRecords] = useState<SleepRecord[]>([]);
  const [tonight, setTonight] = useState<SleepRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const latestQueuedTap = useRef<string | null>(null);
  const loadSequence = useRef(0);
  const [undoRecord, setUndoRecord] = useState<{ saved: SleepRecord; previous: SleepRecord | null } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  function clearUndo() {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setUndoRecord(null);
  }

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      const [latest, current] = await Promise.all([
        getLatestSleepRecords(db, 7),
        getSleepRecordForNight(db, sleepNightDate(new Date())),
      ]);
      if (sequence === loadSequence.current) { setRecords(latest); setTonight(current); }
    } catch {
      if (sequence === loadSequence.current) await showAppDialog({ title: '暂时无法读取睡眠记录', message: '请稍后重新进入这个页面。' });
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [db]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function recordNow() {
    const tappedAt = new Date().toISOString();
    if (savingRef.current) {
      latestQueuedTap.current = tappedAt;
      return;
    }
    savingRef.current = true;
    setSaving(true);
    clearUndo();
    try {
      const previous = await getSleepRecordForNight(db, sleepNightDate(new Date(tappedAt)));
      let timeToSave: string | null = tappedAt;
      let saved: SleepRecord | null = null;
      while (timeToSave) {
        saved = await saveSleepRecord(db, timeToSave);
        const queuedTap = latestQueuedTap.current;
        latestQueuedTap.current = null;
        timeToSave = queuedTap;
      }
      setTonight(saved);
      savingRef.current = false;
      setSaving(false);
      await load();
      if (saved) {
        setUndoRecord({ saved, previous });
        undoTimer.current = setTimeout(() => { setUndoRecord(null); undoTimer.current = null; }, 6000);
      }
    } catch {
      await showAppDialog({ title: '记录没有保存', message: '请重试，或者稍后在历史记录中补记。' });
    } finally { latestQueuedTap.current = null; savingRef.current = false; setSaving(false); }
  }

  async function undoLastRecord() {
    if (!undoRecord || savingRef.current) return;
    const { saved, previous } = undoRecord;
    clearUndo();
    savingRef.current = true;
    setSaving(true);
    try {
      const current = await getSleepRecordForNight(db, saved.nightDate);
      if (!current || current.id !== saved.id || current.occurredAt !== saved.occurredAt) return;
      if (previous) await saveSleepRecord(db, previous.occurredAt, saved.id);
      else await deleteSleepRecord(db, saved.id);
      await load();
    } catch { await showAppDialog({ title: '撤销失败', message: '请长按最近记录手动修改。' }); }
    finally { savingRef.current = false; setSaving(false); }
  }

  async function manageRecord(record: SleepRecord) {
    const answer = await showAppDialog({ title: `${nightLabel(record.nightDate)} · ${timeLabel(record.occurredAt)}`, actions: [{ label: '取消', value: 'cancel' }, { label: '编辑时间', value: 'edit' }, { label: '删除记录', value: 'delete', tone: 'danger' }] });
    if (answer === 'edit') {
      const [year, month] = record.nightDate.split('-').map(Number);
      router.push(`/sleep-log/history?year=${year}&month=${month}&editId=${encodeURIComponent(String(record.id))}` as Href);
    } else if (answer === 'delete') {
      const confirm = await showAppDialog({ title: '删除这条睡眠记录？', actions: [{ label: '取消', value: 'cancel' }, { label: '删除', value: 'delete', tone: 'danger' }] });
      if (confirm === 'delete') {
        try { await deleteSleepRecord(db, record.id); await load(); }
        catch { await showAppDialog({ title: '删除失败', message: '这条记录暂时无法删除，请稍后重试。' }); }
      }
    }
  }

  return <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="返回" hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable>
      <Text style={[styles.headerTitle, { color: readingTheme.text }]}>睡眠记录</Text>
      <View style={styles.headerRight} />
    </View>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Pressable accessibilityRole="button" accessibilityLabel={tonight ? `更新入睡时间，当前记录 ${timeLabel(tonight.occurredAt)}` : '记录现在的入睡时间'} onPress={() => void recordNow()} style={({ pressed }) => [styles.circle, { backgroundColor: readingTheme.surface, borderColor: colors.primary }, pressed && styles.pressed]}>
        {saving ? <><ActivityIndicator color={colors.primary} /><Text style={[styles.circleHint, { color: readingTheme.secondary }]}>正在保存，再点可更新时间</Text></> : <>
          <SymbolView name={{ ios: 'moon.stars.fill', android: 'bedtime', web: 'bedtime' }} size={34} tintColor={colors.primary} />
          <Text style={styles.circleTime}>{tonight ? timeLabel(tonight.occurredAt) : '记录入睡'}</Text>
          <Text style={[styles.circleHint, { color: readingTheme.secondary }]}>{tonight ? '再点一下，更新时间' : '点一下，记下此刻'}</Text>
        </>}
      </Pressable>
      {undoRecord ? <View style={[styles.undoBar, { backgroundColor: readingTheme.surface, borderColor: readingTheme.border }]}><Text style={[styles.undoText, { color: readingTheme.text }]}>{`已记录 ${timeLabel(undoRecord.saved.occurredAt)}`}</Text><Pressable accessibilityRole="button" accessibilityLabel="撤销刚才的睡眠记录" onPress={() => void undoLastRecord()} style={styles.undoButton}><Text style={styles.undoButtonText}>撤销</Text></Pressable></View> : null}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: readingTheme.text }]}>最近记录</Text>
        <View style={styles.sectionActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="查看睡眠统计" onPress={() => router.push('/sleep-log/stats' as Href)} style={styles.statsLink}><SymbolView name={{ ios: 'chart.line.uptrend.xyaxis', android: 'show_chart', web: 'show_chart' }} size={14} tintColor={colors.primary} /><Text style={styles.actionText}>统计</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.push('/sleep-log/history' as Href)} style={styles.historyLink}><Text style={styles.actionText}>查看全部</Text><Text style={styles.chevron}>›</Text></Pressable>
        </View>
      </View>
      {loading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : records.length ? <View style={[styles.list, { backgroundColor: readingTheme.surface }]}>
        {records.slice(0, 5).map((record, index) => <Pressable key={record.id} accessibilityRole="button" accessibilityLabel={`${nightLabel(record.nightDate)} ${timeLabel(record.occurredAt)}，长按编辑或删除`} onLongPress={() => void manageRecord(record)} delayLongPress={350} style={({ pressed }) => [styles.row, index > 0 && { borderTopColor: readingTheme.border, borderTopWidth: StyleSheet.hairlineWidth }, pressed && styles.pressed]}>
          <View style={[styles.rowIcon, { backgroundColor: readingTheme.background }]}><SymbolView name={{ ios: 'moon.fill', android: 'bedtime', web: 'bedtime' }} size={15} tintColor={colors.primary} /></View>
          <View style={styles.rowText}><Text style={[styles.rowDate, { color: readingTheme.text }]}>{dateLabel(record.nightDate)}</Text></View>
          <Text style={[styles.rowTime, { color: readingTheme.text }]}>{timeLabel(record.occurredAt)}</Text>
        </Pressable>)}
      </View> : <View style={[styles.empty, { backgroundColor: readingTheme.surface }]}><Text style={[styles.emptyTitle, { color: readingTheme.secondary }]}>还没有记录</Text></View>}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, header: { height: 52, paddingHorizontal: spacing.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth }, back: { color: colors.primary, fontSize: 13 }, headerTitle: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, headerRight: { width: 42 },
  content: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: 28 }, circle: { width: 184, height: 184, marginTop: spacing.md, borderRadius: 92, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm }, pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] }, circleTime: { color: colors.primary, fontFamily: fonts.serif, fontSize: 21, fontWeight: '600' }, circleHint: { color: colors.textSecondary, fontSize: 11 },
  undoBar: { width: '100%', minHeight: 40, marginTop: spacing.sm, paddingHorizontal: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, undoText: { fontSize: 11 }, undoButton: { minHeight: 40, paddingHorizontal: spacing.sm, justifyContent: 'center' }, undoButtonText: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  sectionHeader: { width: '100%', marginTop: spacing.xxl, marginBottom: spacing.sm, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, sectionTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' }, sectionActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, statsLink: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs }, historyLink: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: spacing.sm, paddingLeft: spacing.xs }, actionText: { color: colors.primary, fontSize: 11, fontWeight: '600' }, chevron: { color: colors.primary, fontSize: 17 }, list: { width: '100%', borderRadius: radii.lg, paddingHorizontal: spacing.md }, row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, rowIcon: { width: 32, height: 32, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' }, rowText: { flex: 1 }, rowDate: { fontFamily: fonts.serif, fontSize: 13 }, rowTime: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] }, loader: { marginVertical: spacing.xxl }, empty: { width: '100%', borderRadius: radii.lg, alignItems: 'center', padding: spacing.lg }, emptyTitle: { fontSize: 13 },
});
