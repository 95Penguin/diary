import { useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showAppDialog } from '@/components/app-dialog-host';

import { getJournalStats, getLastExportAt } from '@/database/journal-repository';
import type { JournalStats } from '@/domain/journal';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { collectLocationDiagnostics, formatLocationDiagnostics, type LocationDiagnostics } from '@/utils/location-diagnostics';
import { clearAppErrorLog, formatAppErrorLog, readAppErrorLog, recordAppError, type AppErrorLogItem } from '@/utils/app-error-log';
import { exportDiagnosticText } from '@/utils/diagnostic-export';
import { formatStartupMetrics, getStartupMetrics } from '@/utils/startup-performance';

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

function permissionLabel(value: string | undefined) {
  if (value === 'granted') return '已允许';
  if (value === 'denied') return '未允许';
  if (value === 'undetermined') return '尚未询问';
  return value ?? '检查中';
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
  const [locationDiagnostics, setLocationDiagnostics] = useState<LocationDiagnostics | null>(null);
  const [errorLog, setErrorLog] = useState<AppErrorLogItem[]>([]);
  const [exported, setExported] = useState(false);
  const [packageCopied, setPackageCopied] = useState(false);
  const [startupMetrics, setStartupMetrics] = useState(getStartupMetrics());
  const version = Constants.expoConfig?.version ?? '未知';
  const packageName = Constants.expoConfig?.android?.package ?? Constants.expoConfig?.ios?.bundleIdentifier ?? '未知';
  // Native API keys are intentionally removed from the runtime manifest. The
  // dynamic config exposes only this non-secret build-time status flag.
  const mapsKeyConfigured = Constants.expoConfig?.extra?.amapConfigured === true;

  const load = useCallback(async () => {
    try {
      const [versionRow, statusRow, lastExportAt, stats, location, errors] = await Promise.all([
        db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'),
        db.getFirstAsync<{ quick_check: string }>('PRAGMA quick_check'),
        getLastExportAt(db),
        getJournalStats(db),
        collectLocationDiagnostics(),
        readAppErrorLog(),
      ]);
      setDiagnostics({
        databaseVersion: versionRow?.user_version ?? 0,
        databaseStatus: statusRow?.quick_check === 'ok' ? '正常' : statusRow?.quick_check ?? '未知',
        lastExportAt,
        stats,
      });
      setLocationDiagnostics(location);
      setErrorLog(errors);
      setStartupMetrics(getStartupMetrics());
    } catch (error) {
      void recordAppError('about.load-diagnostics', error);
      setDiagnostics((current) => ({ ...current, databaseStatus: '检查失败' }));
    }
  }, [db]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function diagnosticText() {
    return [
      `拾时 ${version}`,
      `包名：${packageName}`,
      `平台：${Platform.OS} ${String(Platform.Version)}`,
      `数据库：${diagnostics.databaseStatus}（版本 ${diagnostics.databaseVersion}）`,
      `记录：${diagnostics.stats.entries}`,
      `后续：${diagnostics.stats.followUps}`,
      `媒体：${diagnostics.stats.images}`,
      `回收站：${diagnostics.stats.deleted}`,
      `最近备份：${formatDate(diagnostics.lastExportAt)}`,
      `高德 Android 地图密钥：${mapsKeyConfigured ? '已注入' : '未检测到'}`,
      ...(locationDiagnostics ? ['', formatLocationDiagnostics(locationDiagnostics)] : []),
      '',
      '启动性能：',
      formatStartupMetrics(),
      '',
      formatAppErrorLog(errorLog),
    ].join('\n');
  }

  async function copyPackageName() {
    await Clipboard.setStringAsync(packageName);
    setPackageCopied(true);
    setTimeout(() => setPackageCopied(false), 1_800);
  }

  const mapAdvice = !mapsKeyConfigured
    ? '未检测到地图密钥：请确认 AMAP_ANDROID_API_KEY 已注入当前构建环境，然后重新构建。'
    : locationDiagnostics?.permission === 'denied'
      ? '位置权限未允许：地图仍可浏览，但无法定位到当前位置。'
      : locationDiagnostics?.servicesEnabled === false
        ? '系统定位已关闭：请在手机设置中开启定位服务。'
        : locationDiagnostics?.mapsServiceReachable === false
          ? '当前设备无法连接高德地图服务：请检查网络，或暂时使用地点列表。'
          : locationDiagnostics?.mapsServiceReachable === true
            ? '基础检查正常；若底图仍为空，请核对高德控制台中的包名、SHA-1 和 Android Key。'
            : '正在检查地图服务连接。';

  async function copyDiagnostics() {
    await Clipboard.setStringAsync(diagnosticText());
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function exportDiagnostics() {
    try {
      const stamp = new Date().toLocaleDateString('sv-SE');
      await exportDiagnosticText(diagnosticText(), `拾时诊断-${stamp}.txt`);
      setExported(true);
      setTimeout(() => setExported(false), 1800);
    } catch (error) {
      await recordAppError('about.export-diagnostics', error);
      await showAppDialog({ title: '导出失败', message: '暂时无法打开系统分享，请先使用“复制诊断信息”。' });
    }
  }

  async function confirmClearErrors() {
    const decision = await showAppDialog({
      title: '清除错误记录？',
      message: '只会清除本机的脱敏技术日志，不影响日记和备份。',
      actions: [{ label: '取消', value: 'cancel' }, { label: '清除', value: 'clear', tone: 'danger' }],
    });
    if (decision !== 'clear') return;
    await clearAppErrorLog();
    setErrorLog([]);
  }

  return <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}>
      <Pressable hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable>
      <Text style={[styles.title, { color: readingTheme.text }]}>关于拾时</Text>
      <View style={styles.headerSpace} />
    </View>
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={[styles.hero, { backgroundColor: readingTheme.surface }]}>
        <Image source={require('../../assets/images/shishi-icon-v3.png')} contentFit="cover" style={styles.appIcon} />
        <View style={styles.heroCopy}>
          <View style={styles.nameRow}>
            <Text style={[styles.appName, { color: readingTheme.text }]}>拾时</Text>
            <Text style={[styles.version, { color: readingTheme.secondary }]}>v{version}</Text>
          </View>
          <Text style={[styles.tagline, { color: readingTheme.secondary }]}>把日子慢慢收好。</Text>
        </View>
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

      <Text style={[styles.sectionTitle, { color: readingTheme.secondary }]}>定位诊断</Text>
      <View style={[styles.card, { backgroundColor: readingTheme.surface }]}>
        <InfoRow label="位置权限" value={permissionLabel(locationDiagnostics?.permission)} />
        <InfoRow label="系统定位" value={locationDiagnostics?.servicesEnabled == null ? '未知' : locationDiagnostics.servicesEnabled ? '可用' : '不可用'} />
        <InfoRow label="GPS / 网络" value={locationDiagnostics ? `${locationDiagnostics.gpsAvailable == null ? '未知' : locationDiagnostics.gpsAvailable ? '可用' : '不可用'} / ${locationDiagnostics.networkAvailable == null ? '未知' : locationDiagnostics.networkAvailable ? '可用' : '不可用'}` : '检查中'} />
        <InfoRow label="最近坐标" value={locationDiagnostics?.lastPosition ?? '检查中'} />
        <InfoRow label="地图密钥" value={mapsKeyConfigured ? '已注入当前安装包' : '未检测到'} />
        <InfoRow label="地图服务连接" value={locationDiagnostics?.mapsServiceReachable == null ? '检查中' : locationDiagnostics.mapsServiceReachable ? '可访问' : '不可访问'} />
      </View>
      <Text style={[styles.mapDiagnosticHint, { color: readingTheme.secondary }]}>{mapAdvice}</Text>
      <Pressable onPress={() => void copyPackageName()} style={[styles.inlineButton, { borderColor: readingTheme.border }]}>
        <Text style={styles.inlineButtonText}>{packageCopied ? '包名已复制' : '复制应用包名'}</Text>
      </Pressable>

      <Text style={[styles.sectionTitle, { color: readingTheme.secondary }]}>启动性能</Text>
      <View style={[styles.card, { backgroundColor: readingTheme.surface }]}>
        <InfoRow label="数据库初始化" value={startupMetrics.database == null ? '尚未完成' : `${startupMetrics.database} 毫秒`} />
        <InfoRow label="偏好设置读取" value={startupMetrics.preferences == null ? '尚未完成' : `${startupMetrics.preferences} 毫秒`} />
        <InfoRow label="首页首批记录" value={startupMetrics.home == null ? '尚未完成' : `${startupMetrics.home} 毫秒`} />
      </View>

      <Text style={[styles.sectionTitle, { color: readingTheme.secondary }]}>最近错误</Text>
      <View style={[styles.card, { backgroundColor: readingTheme.surface }]}>
        {errorLog.length ? errorLog.slice(-5).reverse().map((item, index) =>
          <View key={item.id} style={[styles.errorLogRow, index < Math.min(errorLog.length, 5) - 1 && { borderBottomColor: readingTheme.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
            <View style={styles.errorLogHeader}><Text style={[styles.errorContext, { color: readingTheme.text }]}>{item.context}</Text><Text style={[styles.errorTime, { color: readingTheme.secondary }]}>{formatDate(item.occurredAt)}</Text></View>
            <Text numberOfLines={2} style={[styles.errorMessage, { color: readingTheme.secondary }]}>{item.name}: {item.message}</Text>
          </View>) :
          <Text style={[styles.noErrors, { color: readingTheme.secondary }]}>没有记录到应用错误</Text>}
      </View>
      {errorLog.length ? <Pressable accessibilityRole="button" onPress={confirmClearErrors} style={styles.clearErrors}><Text style={[styles.clearErrorsText, { color: readingTheme.secondary }]}>清除错误记录</Text></Pressable> : null}

      <Pressable onPress={() => void copyDiagnostics()} style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}>
        <Text style={styles.copyText}>{copied ? '已复制' : '复制诊断信息'}</Text>
      </Pressable>
      <Pressable onPress={() => void exportDiagnostics()} style={({ pressed }) => [styles.exportButton, { borderColor: readingTheme.border }, pressed && styles.pressed]}>
        <Text style={styles.exportText}>{exported ? '已打开分享' : '导出脱敏诊断 TXT'}</Text>
      </Pressable>
      <Text style={[styles.hint, { color: readingTheme.secondary }]}>诊断仅包含运行状态和最近 30 条脱敏错误，不包含日记正文、地址、坐标、头像或 API Key。</Text>
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
  hero: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, padding: spacing.lg, borderRadius: radii.lg },
  appIcon: { width: 56, height: 56, borderRadius: 14 },
  heroCopy: { flex: 1, marginLeft: spacing.md },
  nameRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  appName: { fontFamily: fonts.serif, fontSize: 23, fontWeight: '600' },
  version: { fontSize: 11 },
  tagline: { marginTop: spacing.xs, fontSize: 13 },
  sectionTitle: { marginTop: spacing.lg, marginBottom: 6, fontSize: 12, letterSpacing: 1 },
  card: { overflow: 'hidden', paddingHorizontal: spacing.md, borderRadius: radii.md },
  infoRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  infoLabel: { flexShrink: 0, fontSize: 12 }, infoValue: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: '600', textAlign: 'right' },
  errorLogRow: { minHeight: 58, justifyContent: 'center', paddingVertical: spacing.sm },
  errorLogHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  errorContext: { flex: 1, fontSize: 12, fontWeight: '700' },
  errorTime: { fontSize: 11 },
  errorMessage: { marginTop: 3, fontSize: 11, lineHeight: 17 },
  mapDiagnosticHint: { marginTop: spacing.sm, fontSize: 11, lineHeight: 18 },
  inlineButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md },
  inlineButtonText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  noErrors: { paddingVertical: spacing.lg, fontSize: 12, textAlign: 'center' },
  clearErrors: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  clearErrorsText: { fontSize: 12 },
  copyButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xl, paddingVertical: spacing.sm, borderRadius: radii.md, backgroundColor: colors.primary },
  copyText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' }, pressed: { opacity: 0.62 },
  exportButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm, paddingVertical: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md },
  exportText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  hint: { marginTop: spacing.sm, fontSize: 11, lineHeight: 17, textAlign: 'center' },
});
