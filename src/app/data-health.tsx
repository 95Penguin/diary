import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { File } from 'expo-file-system';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';

import { dataHealthLevel, runDataHealthCheck, type DataHealthReport } from '@/database/data-health';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { formatShortDateTime } from '@/utils/date';

export default function DataHealthScreen() {
  const db = useSQLiteContext();
  const { preferences, readingTheme } = useAppPreferences();
  const [report, setReport] = useState<DataHealthReport | null>(null);
  const [checking, setChecking] = useState(true);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setReport(await runDataHealthCheck(db, (uri) => new File(uri).exists));
    } finally { setChecking(false); }
  }, [db]);

  useFocusEffect(useCallback(() => { void check(); }, [check]));
  const checkedTime = report ? new Date(report.checkedAt) : null;
  const latestBackup = report ? latestDate(report.lastExportAt, preferences.lastAutomaticBackupAt) : null;
  const baseLevel = report && checkedTime ? dataHealthLevel({ ...report, lastExportAt: latestBackup }, checkedTime) : null;
  const level = baseLevel === 'healthy' && preferences.lastBackupHealth === 'failed' ? 'attention' : baseLevel;
  const backupDays = latestBackup && checkedTime ? Math.max(0, Math.floor((checkedTime.getTime() - new Date(latestBackup).getTime()) / 86_400_000)) : null;

  return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}><Pressable accessibilityLabel="返回" hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable><Text style={[styles.title, { color: readingTheme.text }]}>数据与备份体检</Text><View style={styles.headerSpace} /></View>
    {checking && !report ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : report ? <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={[styles.hero, { backgroundColor: level === 'healthy' ? colors.primarySoft : readingTheme.surface }]}><View style={[styles.statusIcon, level === 'critical' ? styles.statusCritical : level === 'attention' ? styles.statusAttention : styles.statusHealthy]}><Text style={styles.statusIconText}>{level === 'healthy' ? '✓' : '!'}</Text></View><View style={styles.heroCopy}><Text style={[styles.heroTitle, { color: readingTheme.text }]}>{level === 'healthy' ? '当前状态良好' : level === 'critical' ? '有数据需要尽快处理' : '有几项建议处理'}</Text><Text style={[styles.heroText, { color: readingTheme.secondary }]}>检查于 {formatShortDateTime(report.checkedAt)} · 全程只读，没有修改记录</Text></View></View>

      <Text style={[styles.sectionTitle, { color: readingTheme.secondary }]}>检查项目</Text>
      <HealthCard title="数据库" status={report.databaseOk && !report.foreignKeyIssues && !report.invalidDates ? '正常' : '需处理'} tone={!report.databaseOk || report.foreignKeyIssues ? 'critical' : report.invalidDates ? 'attention' : 'healthy'} detail={`完整性：${report.databaseMessage} · 关联异常 ${report.foreignKeyIssues} · 时间异常 ${report.invalidDates}`} />
      <HealthCard title="本地媒体" status={report.missingMediaFiles ? `缺少 ${report.missingMediaFiles} 个文件` : '引用完整'} tone={report.missingMediaFiles ? 'critical' : 'healthy'} detail={`数据库共引用 ${report.referencedMediaFiles} 个图片、视频或封面文件`} />
      <HealthCard title="外部备份" status={!latestBackup ? '尚未备份' : backupDays === 0 ? '今天备份过' : `${backupDays} 天前`} tone={!latestBackup || (backupDays ?? 0) > 30 || preferences.lastBackupHealth === 'failed' ? 'attention' : 'healthy'} detail={preferences.lastBackupHealth === 'failed' ? '最近一次备份完整性检查没有通过' : preferences.lastBackupHealth === 'warning' ? '最近备份可以打开，但存在媒体缺失' : '建议至少保留一份应用外部的完整 ZIP'} action="去备份" onAction={() => router.push('/backup')} />
      <HealthCard title="回收站" status={`${report.stats.deleted} 条`} tone={report.expiredTrashEntries ? 'attention' : 'healthy'} detail={report.expiredTrashEntries ? `${report.expiredTrashEntries} 条已超过 30 天，应用下次清理时会永久删除` : '没有等待清理的过期记录'} action={report.stats.deleted ? '查看' : undefined} onAction={() => router.push('/trash')} />

      <Text style={[styles.sectionTitle, { color: readingTheme.secondary }]}>建议</Text>
      <View style={[styles.advice, { backgroundColor: readingTheme.surface }]}>
        {report.missingMediaFiles ? <Advice text="媒体文件缺失时，先不要卸载应用。可以从较早的完整 ZIP 恢复，或打开相关记录确认是否需要移除失效媒体。" /> : null}
        {!latestBackup || (backupDays ?? 0) > 30 ? <Advice text="当前没有近期外部备份。建议现在导出完整 ZIP，并保存到手机文件夹或网盘目录。" /> : null}
        {!report.databaseOk || report.foreignKeyIssues ? <Advice text="数据库完整性异常。请先导出能够成功生成的备份，不要清理应用数据，并保留诊断信息。" /> : null}
        {level === 'healthy' ? <Advice text="数据关系和本地媒体均正常。继续定期生成完整 ZIP，即可保持较好的可恢复性。" /> : null}
      </View>
      <Pressable disabled={checking} onPress={() => void check()} style={[styles.recheck, checking && styles.disabled]}>{checking ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.recheckText}>重新检查</Text>}</Pressable>
      <Pressable onPress={() => router.push('/about' as Href)} style={styles.diagnostics}><Text style={[styles.diagnosticsText, { color: readingTheme.secondary }]}>查看详细运行诊断</Text></Pressable>
    </ScrollView> : <View style={styles.loader}><Text style={[styles.failure, { color: readingTheme.secondary }]}>检查没有完成，请重新打开此页面。</Text></View>}
  </SafeAreaView>;
}

function latestDate(...values: (string | null)[]) { return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null; }

function HealthCard({ title, status, tone, detail, action, onAction }: { title: string; status: string; tone: 'healthy' | 'attention' | 'critical'; detail: string; action?: string; onAction?: () => void }) {
  const { readingTheme } = useAppPreferences();
  return <View style={[styles.card, { backgroundColor: readingTheme.surface }]}><View style={styles.cardHeader}><View style={[styles.dot, tone === 'healthy' ? styles.dotHealthy : tone === 'attention' ? styles.dotAttention : styles.dotCritical]} /><Text style={[styles.cardTitle, { color: readingTheme.text }]}>{title}</Text><Text style={[styles.cardStatus, tone === 'critical' ? styles.criticalText : tone === 'attention' ? styles.attentionText : styles.healthyText]}>{status}</Text></View><Text style={[styles.cardDetail, { color: readingTheme.secondary }]}>{detail}</Text>{action ? <Pressable onPress={onAction} style={styles.cardAction}><Text style={styles.cardActionText}>{action} ›</Text></Pressable> : null}</View>;
}

function Advice({ text }: { text: string }) { const { readingTheme } = useAppPreferences(); return <View style={styles.adviceRow}><Text style={styles.adviceBullet}>•</Text><Text style={[styles.adviceText, { color: readingTheme.secondary }]}>{text}</Text></View>; }

const styles = StyleSheet.create({
  safe: { flex: 1 }, header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth }, back: { color: colors.primary, fontSize: 13 }, title: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, headerSpace: { width: 42 }, loader: { flex: 1, alignItems: 'center', justifyContent: 'center' }, failure: { fontSize: 12 },
  scroll: { padding: spacing.xl, paddingBottom: spacing.xxxl }, hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radii.lg }, statusIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21 }, statusHealthy: { backgroundColor: colors.primary }, statusAttention: { backgroundColor: '#B88028' }, statusCritical: { backgroundColor: colors.danger }, statusIconText: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' }, heroCopy: { flex: 1 }, heroTitle: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '600' }, heroText: { marginTop: 3, fontSize: 10, lineHeight: 16 },
  sectionTitle: { marginTop: spacing.xl, marginBottom: spacing.sm, fontSize: 11, letterSpacing: 1 }, card: { marginBottom: spacing.sm, padding: spacing.md, borderRadius: radii.md }, cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, dot: { width: 8, height: 8, borderRadius: 4 }, dotHealthy: { backgroundColor: colors.primary }, dotAttention: { backgroundColor: '#B88028' }, dotCritical: { backgroundColor: colors.danger }, cardTitle: { flex: 1, fontSize: 13, fontWeight: '700' }, cardStatus: { fontSize: 11, fontWeight: '700' }, healthyText: { color: colors.primary }, attentionText: { color: '#9A681C' }, criticalText: { color: colors.danger }, cardDetail: { marginTop: spacing.sm, fontSize: 10, lineHeight: 17 }, cardAction: { alignSelf: 'flex-end', minHeight: 32, justifyContent: 'center', marginTop: spacing.xs }, cardActionText: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  advice: { padding: spacing.md, borderRadius: radii.md }, adviceRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs }, adviceBullet: { color: colors.primary, fontSize: 15 }, adviceText: { flex: 1, fontSize: 11, lineHeight: 18 }, recheck: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xl, borderRadius: radii.md, backgroundColor: colors.primary }, recheckText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' }, disabled: { opacity: 0.5 }, diagnostics: { minHeight: 44, alignItems: 'center', justifyContent: 'center' }, diagnosticsText: { fontSize: 11 },
});
