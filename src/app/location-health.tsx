import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { getLocationHealthReport, transformHistoricalCoordinates, type LocationHealthReport } from '@/database/journal-repository';
import { showAppDialog } from '@/components/app-dialog-host';
import { useAppPreferences, type ExportLocationMode, type LocationPrivacyMode } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

export default function LocationHealthScreen() {
  const db = useSQLiteContext();
  const { preferences, readingTheme, updatePreferences } = useAppPreferences();
  const [report, setReport] = useState<LocationHealthReport | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const load = useCallback(async () => {
    setLoadFailed(false);
    try { setReport(await getLocationHealthReport(db)); }
    catch { setLoadFailed(true); }
  }, [db]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function confirmCoordinateTransform(action: 'approximate' | 'remove') {
    const count = report?.savedCoordinates ?? 0;
    if (!count) { await showAppDialog({ title: '没有需要处理的坐标' }); return; }
    const confirmed = await showAppDialog({
      title: action === 'remove' ? '删除历史坐标？' : '模糊历史坐标？',
      message: action === 'remove'
        ? `将清除 ${count} 条记录中的经纬度，只保留地点名称。操作前建议先导出完整 ZIP 备份。`
        : `将把 ${count} 条记录的坐标模糊到约 1 公里范围。操作前建议先导出完整 ZIP 备份。`,
      actions: [
        { label: '取消', value: 'cancel' },
        { label: action === 'remove' ? '确认删除' : '确认模糊', value: 'confirm', tone: 'danger' },
      ],
    });
    if (confirmed !== 'confirm') return;
    const changed = await transformHistoricalCoordinates(db, action);
    setReport(await getLocationHealthReport(db));
    await showAppDialog({ title: '处理完成', message: `已处理 ${changed} 条记录。地点名称和正文没有改变。` });
  }

  return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}><Pressable hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable><Text style={[styles.title, { color: readingTheme.text }]}>地点隐私与体检</Text><View style={styles.space} /></View>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={[styles.sectionTitle, { color: readingTheme.secondary }]}>地点体检</Text>
      {!report ? loadFailed ? <View style={styles.loadFailure}><Text style={[styles.description, { color: readingTheme.secondary }]}>地点体检暂时没有加载出来，记录仍保存在本机。</Text><Pressable onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>重新加载</Text></Pressable></View> : <ActivityIndicator color={colors.primary} /> : <View style={[styles.card, { backgroundColor: readingTheme.surface }]}>
        <HealthRow label="缺少坐标" value={report.missingCoordinates} detail="可在足迹地图中批量补点" onPress={() => router.push('/footprint-map' as Href)} />
        <HealthRow label="疑似重复地点" value={report.duplicateSuggestions} detail="合并别名，避免同一地点重复点亮" onPress={() => router.push('/metadata' as Href)} />
        <HealthRow label="地点名称过长" value={report.longLocationNames} detail="建议改为易读的简称" onPress={() => router.push('/metadata' as Href)} />
        <HealthRow label="有坐标但无名称" value={report.unnamedCoordinates} detail="不会显示在足迹地图中" last />
      </View>}

      <Text style={[styles.sectionTitle, { color: readingTheme.secondary }]}>保存位置时</Text>
      <Text style={[styles.description, { color: readingTheme.secondary }]}>该选项作为新记录的隐私策略；已有记录不会被自动修改。</Text>
      <Choice value={preferences.locationPrivacyMode} options={[['precise', '精确坐标'], ['approximate', '模糊到约 1 公里'], ['nameOnly', '只保存地点名'], ['ask', '每次询问']]} onChange={(value) => void updatePreferences({ locationPrivacyMode: value as LocationPrivacyMode })} />

      <Text style={[styles.sectionTitle, { color: readingTheme.secondary }]}>处理已有坐标</Text>
      <View style={[styles.coordinateCard, { backgroundColor: readingTheme.surface }]}>
        <Text style={[styles.coordinateCount, { color: readingTheme.text }]}>当前有 {report?.savedCoordinates ?? 0} 条记录保存了坐标</Text>
        <Text style={[styles.description, { color: readingTheme.secondary }]}>这是一次性清理；不会修改地点名称、正文或完整 ZIP 备份文件。</Text>
        <View style={styles.coordinateActions}>
          <Pressable onPress={() => void confirmCoordinateTransform('approximate')} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>全部模糊到约 1 公里</Text></Pressable>
          <Pressable onPress={() => void confirmCoordinateTransform('remove')} style={[styles.secondaryButton, styles.removeButton]}><Text style={styles.removeButtonText}>全部删除坐标</Text></Pressable>
        </View>
      </View>

      <Text style={[styles.sectionTitle, { color: readingTheme.secondary }]}>可阅读导出</Text>
      <Choice value={preferences.exportLocationMode} options={[['include', '包含地点名称'], ['hidden', '隐藏全部地点']]} onChange={(value) => void updatePreferences({ exportLocationMode: value as ExportLocationMode })} />
      <Text style={[styles.description, { color: readingTheme.secondary }]}>完整 ZIP 备份始终保留原始数据，隐私选项只影响 Markdown/HTML 文件。</Text>
    </ScrollView>
  </SafeAreaView>;
}

function HealthRow({ label, value, detail, onPress, last }: { label: string; value: number; detail: string; onPress?: () => void; last?: boolean }) {
  const { readingTheme } = useAppPreferences();
  return <Pressable disabled={!onPress} onPress={onPress} style={[styles.healthRow, !last && { borderBottomColor: readingTheme.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
    <View style={styles.healthText}><Text style={[styles.healthLabel, { color: readingTheme.text }]}>{label}</Text><Text style={[styles.healthDetail, { color: readingTheme.secondary }]}>{detail}</Text></View>
    <Text style={[styles.count, value === 0 && styles.ok]}>{value === 0 ? '正常' : `${value} 项`}{onPress ? ' ›' : ''}</Text>
  </Pressable>;
}

function Choice({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (value: string) => void }) {
  const { readingTheme } = useAppPreferences();
  return <View style={styles.options}>{options.map(([key, label]) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: value === key }} key={key} onPress={() => onChange(key)} style={[styles.option, { backgroundColor: readingTheme.surface }, value === key && styles.optionActive]}><View style={[styles.radio, value === key && styles.radioActive]} /> <Text style={[styles.optionText, { color: readingTheme.text }]}>{label}</Text></Pressable>)}</View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, header: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth }, back: { color: colors.primary, fontSize: 13 }, title: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' }, space: { width: 40 },
  content: { padding: spacing.xl, paddingBottom: spacing.xxxl }, sectionTitle: { marginTop: spacing.xl, marginBottom: spacing.sm, fontSize: 11 }, description: { marginBottom: spacing.md, fontSize: 11, lineHeight: 18 }, loadFailure: { alignItems: 'center', paddingVertical: spacing.xl }, retry: { minHeight: 42, justifyContent: 'center', paddingHorizontal: spacing.xl, borderRadius: radii.pill, backgroundColor: colors.primary }, retryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' }, card: { borderRadius: radii.md, overflow: 'hidden' }, healthRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }, healthText: { flex: 1, paddingRight: spacing.md }, healthLabel: { fontSize: 12, fontWeight: '600' }, healthDetail: { marginTop: 3, fontSize: 10, lineHeight: 14 }, count: { color: '#B46B54', fontSize: 11, fontWeight: '700' }, ok: { color: colors.primary },
  options: { gap: spacing.sm }, option: { minHeight: 46, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, borderRadius: radii.md }, optionActive: { borderWidth: 1, borderColor: colors.primary }, radio: { width: 16, height: 16, marginRight: spacing.md, borderRadius: 8, borderWidth: 1, borderColor: colors.textFaint }, radioActive: { borderWidth: 5, borderColor: colors.primary }, optionText: { fontSize: 12 },
  coordinateCard: { padding: spacing.lg, borderRadius: radii.lg }, coordinateCount: { fontSize: 13, fontWeight: '600' }, coordinateActions: { gap: spacing.sm, marginTop: spacing.md }, secondaryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.primarySoft }, secondaryButtonText: { color: colors.primary, fontSize: 11, fontWeight: '700' }, removeButton: { backgroundColor: '#F8E9E6' }, removeButtonText: { color: '#A85248', fontSize: 11, fontWeight: '700' },
});
