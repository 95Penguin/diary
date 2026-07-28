import { useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getJournalStats, getLastExportAt } from '@/database/journal-repository';
import type { JournalStats } from '@/domain/journal';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

type Diagnostics = {
  databaseVersion: number;
  databaseStatus: string;
  lastExportAt: string | null;
  stats: JournalStats;
};

const EMPTY_STATS: JournalStats = { entries: 0, followUps: 0, images: 0, deleted: 0 };

function formatDate(value: string | null) {
  if (!value) return '尚未备份';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

export default function AboutScreen() {
  const db = useSQLiteContext();
  const { readingTheme } = useAppPreferences();
  const [diagnostics, setDiagnostics] = useState<Diagnostics>({
    databaseVersion: 0,
    databaseStatus: '检查中',
    lastExportAt: null,
    stats: EMPTY_STATS,
  });
  const [copied, setCopied] = useState(false);
  const version = Constants.expoConfig?.version ?? '未知';
  const packageName = Constants.expoConfig?.android?.package ?? Constants.expoConfig?.ios?.bundleIdentifier ?? '未知';

  const load = useCallback(async () => {
    try {
      const [versionRow, statusRow, lastExportAt, stats] = await Promise.all([
        db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'),
        db.getFirstAsync<{ quick_check: string }>('PRAGMA quick_check'),
        getLastExportAt(db),
        getJournalStats(db),
      ]);
      setDiagnostics({
        databaseVersion: versionRow?.user_version ?? 0,
        databaseStatus: statusRow?.quick_check === 'ok' ? '正常' : statusRow?.quick_check ?? '未知',
        lastExportAt,
        stats,
      });
    } catch {
      setDiagnostics((current) => ({ ...current, databaseStatus: '检查失败' }));
    }
  }, [db]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function copyDiagnostics() {
    const text = [
      `拾时 ${version}`,
      `包名：${packageName}`,
      `平台：${Platform.OS} ${String(Platform.Version)}`,
      `数据库：${diagnostics.databaseStatus}（版本 ${diagnostics.databaseVersion}）`,
      `记录：${diagnostics.stats.entries}`,
      `后续：${diagnostics.stats.followUps}`,
      `媒体：${diagnostics.stats.images}`,
      `回收站：${diagnostics.stats.deleted}`,
      `最近备份：${formatDate(diagnostics.lastExportAt)}`,
    ].join('\n');
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}>
      <Pressable hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable>
      <Text style={[styles.title, { color: readingTheme.text }]}>关于拾时</Text>
      <View style={styles.headerSpace} />
    </View>
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <Text style={[styles.appName, { color: readingTheme.text }]}>拾时</Text>
        <Text style={[styles.version, { color: readingTheme.secondary }]}>版本 {version}</Text>
        <Text style={[styles.tagline, { color: readingTheme.secondary }]}>把日子慢慢收好。</Text>
      </View>

      <Text style={[styles.sectionTitle, { color: readingTheme.secondary }]}>运行状态</Text>
      <View style={[styles.card, { backgroundColor: readingTheme.surface }]}>
        <InfoRow label="数据库状态" value={diagnostics.databaseStatus} />
        <InfoRow label="数据库版本" value={String(diagnostics.databaseVersion)} />
        <InfoRow label="最近备份" value={formatDate(diagnostics.lastExportAt)} />
        <InfoRow label="应用包名" value={packageName} />
      </View>

      <Text style={[styles.sectionTitle, { color: readingTheme.secondary }]}>数据概览</Text>
      <View style={[styles.card, { backgroundColor: readingTheme.surface }]}>
        <InfoRow label="记录" value={`${diagnostics.stats.entries} 条`} />
        <InfoRow label="后续" value={`${diagnostics.stats.followUps} 条`} />
        <InfoRow label="媒体" value={`${diagnostics.stats.images} 个`} />
        <InfoRow label="回收站" value={`${diagnostics.stats.deleted} 条`} />
      </View>

      <Pressable onPress={() => void copyDiagnostics()} style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}>
        <Text style={styles.copyText}>{copied ? '已复制' : '复制诊断信息'}</Text>
      </Pressable>
      <Text style={[styles.hint, { color: readingTheme.secondary }]}>反馈问题时附上诊断信息，有助于快速定位故障；内容不包含记录正文。</Text>
    </ScrollView>
  </SafeAreaView>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const { readingTheme } = useAppPreferences();
  return <View style={[styles.infoRow, { borderBottomColor: readingTheme.border }]}>
    <Text style={[styles.infoLabel, { color: readingTheme.secondary }]}>{label}</Text>
    <Text selectable numberOfLines={2} style={[styles.infoValue, { color: readingTheme.text }]}>{value}</Text>
  </View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { color: colors.primary, fontSize: 13 }, title: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, headerSpace: { width: 42 },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  hero: { alignItems: 'center', paddingVertical: spacing.xxl }, appName: { fontFamily: fonts.serif, fontSize: 25, fontWeight: '600' }, version: { marginTop: spacing.xs, fontSize: 10 }, tagline: { marginTop: spacing.md, fontSize: 11 },
  sectionTitle: { marginTop: spacing.lg, marginBottom: 6, fontSize: 10, letterSpacing: 1 },
  card: { overflow: 'hidden', paddingHorizontal: spacing.md, borderRadius: radii.md },
  infoRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  infoLabel: { fontSize: 10 }, infoValue: { flex: 1, fontSize: 10, fontWeight: '600', textAlign: 'right' },
  copyButton: { height: 44, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xl, borderRadius: radii.md, backgroundColor: colors.primary },
  copyText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' }, pressed: { opacity: 0.62 },
  hint: { marginTop: spacing.sm, fontSize: 9, lineHeight: 15, textAlign: 'center' },
});
