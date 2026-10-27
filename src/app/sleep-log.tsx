import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getLatestSleepRecords, getSleepRecordForNight, saveSleepRecord, sleepNightDate, type SleepRecord } from '@/database/sleep-repository';
import { showAppDialog } from '@/components/app-dialog-host';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { useAppPreferences } from '@/preferences/app-preferences';

function timeLabel(value: string) { return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }); }
function dateLabel(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
}

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
    try {
      let timeToSave: string | null = tappedAt;
      let updated = Boolean(tonight);
      let saved: SleepRecord | null = null;
      while (timeToSave) {
        saved = await saveSleepRecord(db, timeToSave);
        const queuedTap = latestQueuedTap.current;
        latestQueuedTap.current = null;
        timeToSave = queuedTap;
        if (queuedTap) updated = true;
      }
      setTonight(saved);
      savingRef.current = false;
      setSaving(false);
      await load();
      const savedAt = saved?.occurredAt ?? tappedAt;
      await showAppDialog({ title: updated ? '已更新入睡时间' : '已记下入睡时间', message: `${timeLabel(savedAt)}，归在${dateLabel(sleepNightDate(new Date(savedAt)))}这一晚。` });
    } catch {
      await showAppDialog({ title: '记录没有保存', message: '请重试，或者稍后在历史记录中补记。' });
    } finally { latestQueuedTap.current = null; savingRef.current = false; setSaving(false); }
  }

  return <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => router.back()} style={styles.back}><Text style={[styles.backText, { color: readingTheme.text }]}>‹</Text></Pressable>
      <Text style={[styles.headerTitle, { color: readingTheme.text }]}>睡眠记录</Text>
      <View style={styles.headerRight} />
    </View>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={[styles.eyebrow, { color: readingTheme.secondary }]}>今晚，给自己留个时间</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={tonight ? `更新入睡时间，当前记录 ${timeLabel(tonight.occurredAt)}` : '记录现在的入睡时间'} onPress={() => void recordNow()} style={({ pressed }) => [styles.circle, { backgroundColor: colors.primarySoft, borderColor: colors.primary }, pressed && styles.pressed]}>
        {saving ? <><ActivityIndicator color={colors.primary} /><Text style={styles.circleHint}>正在保存，再点可更新时间</Text></> : <>
          <SymbolView name={{ ios: 'moon.stars.fill', android: 'bedtime', web: 'bedtime' }} size={34} tintColor={colors.primary} />
          <Text style={styles.circleTime}>{tonight ? timeLabel(tonight.occurredAt) : '记录入睡'}</Text>
          <Text style={[styles.circleHint, { color: readingTheme.secondary }]}>{tonight ? '再点一下，更新时间' : '点一下，记下此刻'}</Text>
        </>}
      </Pressable>
      <Text style={[styles.midnightHint, { color: readingTheme.secondary }]}>凌晨记录会归到前一晚</Text>

      <View style={styles.sectionHeader}>
        <View><Text style={[styles.sectionTitle, { color: readingTheme.text }]}>最近记录</Text><Text style={[styles.sectionCaption, { color: readingTheme.secondary }]}>每晚只保留一条，可随时修改</Text></View>
        <Pressable accessibilityRole="button" onPress={() => router.push('/sleep-log/history' as Href)} style={styles.historyLink}><Text style={styles.historyLinkText}>查看全部</Text><Text style={styles.chevron}>›</Text></Pressable>
      </View>
      {loading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : records.length ? <View style={[styles.list, { backgroundColor: readingTheme.surface }]}>
        {records.slice(0, 5).map((record, index) => <View key={record.id} style={[styles.row, index > 0 && { borderTopColor: readingTheme.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
          <View style={styles.rowIcon}><SymbolView name={{ ios: 'moon.fill', android: 'bedtime', web: 'bedtime' }} size={17} tintColor={colors.primary} /></View>
          <View style={styles.rowText}><Text style={[styles.rowDate, { color: readingTheme.text }]}>{dateLabel(record.nightDate)}</Text><Text style={[styles.rowSub, { color: readingTheme.secondary }]}>入睡时间</Text></View>
          <Text style={[styles.rowTime, { color: readingTheme.text }]}>{timeLabel(record.occurredAt)}</Text>
        </View>)}
      </View> : <View style={[styles.empty, { backgroundColor: colors.surfaceMuted }]}><Text style={[styles.emptyTitle, { color: readingTheme.text }]}>还没有睡眠记录</Text><Text style={[styles.emptyHint, { color: readingTheme.secondary }]}>从今晚开始，轻轻点一下月亮就好。</Text></View>}
      <Pressable accessibilityRole="button" onPress={() => router.push('/sleep-log/history' as Href)} style={styles.archiveButton}><Text style={styles.archiveButtonText}>按月份查看历史记录</Text><Text style={styles.archiveArrow}>›</Text></Pressable>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, header: { height: 52, paddingHorizontal: spacing.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, back: { width: 44, height: 44, justifyContent: 'center' }, backText: { fontSize: 38, lineHeight: 42, fontWeight: '300' }, headerTitle: { fontFamily: fonts.serif, fontSize: 19, fontWeight: '600' }, headerRight: { width: 44 },
  content: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.xxl, paddingBottom: 40 }, eyebrow: { fontSize: 14, letterSpacing: 1.2 }, circle: { width: 242, height: 242, marginTop: spacing.xl, borderRadius: 121, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md }, pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] }, circleTime: { color: colors.primary, fontFamily: fonts.serif, fontSize: 26, fontWeight: '600' }, circleHint: { fontSize: 12 }, midnightHint: { marginTop: spacing.md, fontSize: 12 },
  sectionHeader: { width: '100%', marginTop: 44, marginBottom: spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, sectionTitle: { fontFamily: fonts.serif, fontSize: 21, fontWeight: '600' }, sectionCaption: { marginTop: 4, fontSize: 11 }, historyLink: { flexDirection: 'row', alignItems: 'center', gap: 3, padding: spacing.sm }, historyLinkText: { color: colors.primary, fontSize: 13, fontWeight: '600' }, chevron: { color: colors.primary, fontSize: 20 }, list: { width: '100%', borderRadius: radii.lg, paddingHorizontal: spacing.lg }, row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, rowIcon: { width: 38, height: 38, borderRadius: radii.pill, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }, rowText: { flex: 1 }, rowDate: { fontFamily: fonts.serif, fontSize: 15 }, rowSub: { marginTop: 4, fontSize: 11 }, rowTime: { fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] }, loader: { marginVertical: spacing.xxl }, empty: { width: '100%', borderRadius: radii.lg, alignItems: 'center', padding: spacing.xl }, emptyTitle: { fontFamily: fonts.serif, fontSize: 16 }, emptyHint: { marginTop: spacing.sm, fontSize: 12 }, archiveButton: { width: '100%', marginTop: spacing.md, minHeight: 54, paddingHorizontal: spacing.lg, borderRadius: radii.md, backgroundColor: colors.surfaceMuted, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, archiveButtonText: { color: colors.primary, fontSize: 13, fontWeight: '600' }, archiveArrow: { color: colors.primary, fontSize: 23 },
});
