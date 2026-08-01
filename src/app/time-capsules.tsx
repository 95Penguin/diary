import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listTimeCapsules, type TimeCapsule, type TimeCapsuleStatus } from '@/database/time-capsule-repository';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { formatShortDateTime } from '@/utils/date';

const TABS: { value: TimeCapsuleStatus; label: string }[] = [
  { value: 'locked', label: '未到期' }, { value: 'ready', label: '可开启' }, { value: 'opened', label: '已开启' },
];

export default function TimeCapsulesScreen() {
  const db = useSQLiteContext();
  const { readingTheme } = useAppPreferences();
  const [capsules, setCapsules] = useState<TimeCapsule[]>([]);
  const [tab, setTab] = useState<TimeCapsuleStatus>('locked');
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState('');
  const [error, setError] = useState(false);
  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try { setCapsules(await listTimeCapsules(db)); setLoadedAt(new Date().toISOString()); setError(false); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, [db]);
  useFocusEffect(useCallback(() => {
    void load(true);
    const timer = setInterval(() => { void load(); }, 30_000);
    return () => clearInterval(timer);
  }, [load]));
  const visible = useMemo(() => capsules.filter((item) => item.status === tab), [capsules, tab]);
  const counts = useMemo(() => new Map(TABS.map((item) => [item.value, capsules.filter((capsule) => capsule.status === item.value).length])), [capsules]);

  return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}><Pressable accessibilityLabel="返回" hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable><Text style={[styles.title, { color: readingTheme.text }]}>时间胶囊</Text><Pressable accessibilityLabel="写一枚时间胶囊" onPress={() => router.push('/time-capsule-compose' as Href)}><Text style={styles.create}>＋ 写一枚</Text></Pressable></View>
    <View style={[styles.tabs, { backgroundColor: readingTheme.surface }]}>{TABS.map((item) => <Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === item.value }} key={item.value} onPress={() => setTab(item.value)} style={[styles.tab, tab === item.value && styles.tabActive]}><Text style={[styles.tabText, { color: readingTheme.secondary }, tab === item.value && styles.tabTextActive]}>{item.label}{counts.get(item.value) ? ` ${counts.get(item.value)}` : ''}</Text></Pressable>)}</View>
    {loading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : error ? <View style={styles.empty}><Text style={[styles.emptyTitle, { color: readingTheme.text }]}>时间胶囊读取失败</Text><Text style={[styles.emptyText, { color: readingTheme.secondary }]}>数据仍保存在本机，可以稍后重试。</Text><Pressable onPress={() => void load(true)} style={styles.emptyButton}><Text style={styles.emptyButtonText}>重新读取</Text></Pressable></View> : <FlatList data={visible} keyExtractor={(item) => item.id} contentContainerStyle={[styles.list, !visible.length && styles.emptyList]} showsVerticalScrollIndicator={false} renderItem={({ item }) => <CapsuleCard capsule={item} loadedAt={loadedAt} />} ListEmptyComponent={<View style={styles.empty}><Text style={[styles.emptyTitle, { color: readingTheme.text }]}>{tab === 'locked' ? '还没有等待未来的胶囊' : tab === 'ready' ? '暂时没有可以开启的胶囊' : '还没有开启过胶囊'}</Text><Text style={[styles.emptyText, { color: readingTheme.secondary }]}>{tab === 'locked' ? '给未来的自己留下一些话吧。' : tab === 'ready' ? '到了约定时间，它会安静地出现在这里。' : '开启过的内容会永久保存在这里。'}</Text>{tab === 'locked' ? <Pressable onPress={() => router.push('/time-capsule-compose' as Href)} style={styles.emptyButton}><Text style={styles.emptyButtonText}>写第一枚胶囊</Text></Pressable> : null}</View>} />}
  </SafeAreaView>;
}

function CapsuleCard({ capsule, loadedAt }: { capsule: TimeCapsule; loadedAt: string }) {
  const { readingTheme } = useAppPreferences();
  return <Pressable onPress={() => router.push(`/time-capsule/${encodeURIComponent(capsule.id)}` as Href)} style={({ pressed }) => [styles.card, { backgroundColor: readingTheme.surface }, capsule.status === 'ready' && styles.readyCard, pressed && styles.pressed]}><View style={styles.cardHeader}><Text style={styles.status}>{capsule.status === 'locked' ? '锁定中' : capsule.status === 'ready' ? '可以开启' : '已开启'}</Text><Text style={[styles.cardTime, { color: readingTheme.secondary }]}>{capsule.status === 'opened' && capsule.openedAt ? `开启于 ${formatShortDateTime(capsule.openedAt)}` : `约定 ${formatShortDateTime(capsule.openAt)}`}</Text></View><Text numberOfLines={2} style={[styles.cardTitle, { color: readingTheme.text }]}>{capsule.title}</Text>{capsule.status === 'locked' ? <Text style={[styles.lockedHint, { color: readingTheme.secondary }]}>{remainingLabel(capsule.openAt, loadedAt)}</Text> : capsule.status === 'ready' ? <Text style={styles.readyHint}>来自过去的你正在等待</Text> : <Text numberOfLines={2} style={[styles.preview, { color: readingTheme.secondary }]}>{capsule.content}</Text>}</Pressable>;
}

function remainingLabel(openAt: string, loadedAt: string) { const days = Math.max(1, Math.ceil((new Date(openAt).getTime() - new Date(loadedAt).getTime()) / 86_400_000)); return days === 1 ? '不到一天后可以开启' : `还有 ${days} 天可以开启`; }

const styles = StyleSheet.create({
  safe: { flex: 1 }, header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth }, back: { color: colors.primary, fontSize: 13 }, title: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, create: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  tabs: { flexDirection: 'row', margin: spacing.md, padding: 2, borderRadius: radii.pill }, tab: { flex: 1, minHeight: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill }, tabActive: { backgroundColor: colors.primary }, tabText: { fontSize: 10, fontWeight: '600' }, tabTextActive: { color: '#FFFFFF', fontWeight: '700' },
  loader: { flex: 1 }, list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl }, emptyList: { flexGrow: 1 }, card: { marginBottom: spacing.sm, padding: spacing.lg, borderRadius: radii.lg }, readyCard: { borderWidth: 1, borderColor: '#C9A85D' }, pressed: { opacity: 0.62 }, cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }, status: { color: colors.primary, fontSize: 9, fontWeight: '800', letterSpacing: 1 }, cardTime: { fontSize: 9 }, cardTitle: { marginTop: spacing.md, fontFamily: fonts.serif, fontSize: 16, lineHeight: 23, fontWeight: '600' }, lockedHint: { marginTop: spacing.sm, fontSize: 10 }, readyHint: { marginTop: spacing.sm, color: '#987127', fontSize: 10 }, preview: { marginTop: spacing.sm, fontSize: 11, lineHeight: 18 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl }, emptyTitle: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, emptyText: { marginTop: spacing.sm, fontSize: 11, lineHeight: 18, textAlign: 'center' }, emptyButton: { marginTop: spacing.xl, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radii.pill, backgroundColor: colors.primary }, emptyButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});
