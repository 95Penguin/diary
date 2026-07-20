import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { getJournalStats } from '@/database/journal-repository';
import type { JournalStats } from '@/domain/journal';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

const EMPTY_STATS: JournalStats = { entries: 0, followUps: 0, images: 0, deleted: 0 };

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const [stats, setStats] = useState(EMPTY_STATS);

  useFocusEffect(useCallback(() => { void getJournalStats(db).then(setStats); }, [db]));

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <Pressable hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable>
      <Text style={styles.title}>我的</Text>
      <View style={styles.headerSpace} />
    </View>
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.profile}>
        <View style={styles.avatar}><Text style={styles.avatarText}>时</Text></View>
        <View><Text style={styles.brand}>拾时</Text><Text style={styles.slogan}>把日子慢慢收好。</Text></View>
      </View>

      <Text style={styles.sectionTitle}>我的日迹</Text>
      <View style={styles.statsCard}>
        <Stat value={stats.entries} label="记录" />
        <View style={styles.statDivider} />
        <Stat value={stats.followUps} label="后续" />
        <View style={styles.statDivider} />
        <Stat value={stats.images} label="图片" />
      </View>

      <Text style={styles.sectionTitle}>数据管理</Text>
      <Pressable onPress={() => router.push('/trash')} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <View><Text style={styles.rowTitle}>回收站</Text><Text style={styles.rowDescription}>删除的记录保留 30 天</Text></View>
        <View style={styles.rowRight}>{stats.deleted > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{stats.deleted}</Text></View> : null}<Text style={styles.arrow}>›</Text></View>
      </Pressable>
      <Pressable onPress={() => router.push('/backup')} style={({ pressed }) => [styles.row, styles.nextRow, pressed && styles.pressed]}>
        <View><Text style={styles.rowTitle}>备份与导出</Text><Text style={styles.rowDescription}>将日迹保存为通用 JSON 文件</Text></View>
        <Text style={styles.arrow}>›</Text>
      </Pressable>

      <View style={styles.coming}><Text style={styles.comingTitle}>接下来</Text><Text style={styles.comingText}>头像与昵称、备份导出、应用锁会陆续放在这里。</Text></View>
    </ScrollView>
  </SafeAreaView>;
}

function Stat({ value, label }: { value: number; label: string }) {
  return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  back: { color: colors.primary, fontSize: 13 }, title: { color: colors.text, fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, headerSpace: { width: 42 },
  scroll: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.xxxl },
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  avatar: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: colors.primary },
  avatarText: { color: '#FFFFFF', fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' },
  brand: { color: colors.text, fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' }, slogan: { marginTop: 1, color: colors.textSecondary, fontSize: 10 },
  sectionTitle: { marginTop: spacing.lg, marginBottom: 6, color: colors.textFaint, fontSize: 10, letterSpacing: 1 },
  statsCard: { height: 64, flexDirection: 'row', alignItems: 'center', borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  stat: { flex: 1, alignItems: 'center', justifyContent: 'center' }, statValue: { color: colors.text, fontFamily: fonts.serif, fontSize: 16, lineHeight: 21, fontWeight: '600', includeFontPadding: false }, statLabel: { marginTop: 1, color: colors.textSecondary, fontSize: 9 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 24, backgroundColor: colors.border },
  row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  nextRow: { marginTop: spacing.sm },
  pressed: { opacity: 0.62 }, rowTitle: { color: colors.text, fontSize: 13, fontWeight: '600' }, rowDescription: { marginTop: 1, color: colors.textFaint, fontSize: 9 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, badge: { minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, borderRadius: 11, backgroundColor: colors.primarySoft }, badgeText: { color: colors.primary, fontSize: 10, fontWeight: '700' }, arrow: { color: colors.textFaint, fontSize: 22 },
  coming: { marginTop: spacing.lg, padding: spacing.md, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  comingTitle: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' }, comingText: { marginTop: spacing.xs, color: colors.textFaint, fontSize: 10, lineHeight: 17 },
});
