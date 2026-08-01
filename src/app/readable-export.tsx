import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showAppDialog } from '@/components/app-dialog-host';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { listEntriesForReadableExport } from '@/database/journal-repository';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { formatReadableJournal, type ReadableExportFormat } from '@/utils/readable-journal-export';
import { shareReadableExport } from '@/utils/readable-export';
import { recordAppError } from '@/utils/app-error-log';

type Range = 'all' | 'year' | 'month';

function exportRange(range: Range) {
  if (range === 'all') return {};
  const now = new Date();
  const start = range === 'year' ? new Date(now.getFullYear(), 0, 1) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = range === 'year' ? new Date(now.getFullYear() + 1, 0, 1) : new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

export default function ReadableExportScreen() {
  const db = useSQLiteContext();
  const { preferences, readingTheme } = useAppPreferences();
  const [format, setFormat] = useState<ReadableExportFormat>('markdown');
  const [range, setRange] = useState<Range>('all');
  const [working, setWorking] = useState(false);

  async function runExport() {
    setWorking(true);
    try {
      const bounds = exportRange(range);
      const entries = await listEntriesForReadableExport(db, bounds.startAt, bounds.endAt);
      if (!entries.length) { await showAppDialog({ title: '没有可导出的记录', message: '请更换时间范围后再试。' }); return; }
      const contents = formatReadableJournal(entries, format, {
        includeLocations: preferences.exportLocationMode === 'include',
        title: `${preferences.nickname}的拾时日记`,
      });
      const stamp = new Date().toISOString().slice(0, 10);
      const extension = format === 'html' ? 'html' : 'md';
      await shareReadableExport(contents, `拾时日记-${stamp}.${extension}`, format === 'html' ? 'text/html' : 'text/markdown');
    } catch (error) {
      void recordAppError('readable-export', error);
      await showAppDialog({ title: '导出失败', message: '文件暂时无法生成，请稍后重试。' });
    } finally { setWorking(false); }
  }

  return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}><Pressable accessibilityLabel="返回" hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable><Text style={[styles.title, { color: readingTheme.text }]}>可阅读导出</Text><View style={styles.space} /></View>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={[styles.note, styles.introNote, { color: readingTheme.secondary }]}>Markdown 适合长期保存和继续编辑；HTML 适合直接用浏览器阅读。媒体文件仍保留在完整 ZIP 备份中。</Text>
      <Choice title="文件格式" value={format} items={[['markdown', 'Markdown'], ['html', 'HTML 网页']]} onChange={(value) => setFormat(value as ReadableExportFormat)} />
      <Choice title="时间范围" value={range} items={[['all', '全部'], ['year', '今年'], ['month', '本月']]} onChange={(value) => setRange(value as Range)} />
      <View style={[styles.privacy, { backgroundColor: readingTheme.surface }]}><Text style={[styles.privacyTitle, { color: readingTheme.text }]}>地点信息</Text><Text style={[styles.note, { color: readingTheme.secondary }]}>{preferences.exportLocationMode === 'include' ? '将包含地点名称' : '已按隐私设置隐藏地点'}</Text></View>
      <Pressable disabled={working} onPress={() => void runExport()} style={[styles.primary, working && styles.disabled]}>{working ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>生成并分享</Text>}</Pressable>
    </ScrollView>
  </SafeAreaView>;
}

function Choice({ title, value, items, onChange }: { title: string; value: string; items: [string, string][]; onChange: (value: string) => void }) {
  const { readingTheme } = useAppPreferences();
  return <View style={styles.block}><Text style={[styles.blockTitle, { color: readingTheme.secondary }]}>{title}</Text><View style={styles.choices}>{items.map(([key, label]) => <Pressable key={key} onPress={() => onChange(key)} style={[styles.choice, { backgroundColor: readingTheme.surface }, value === key && styles.active]}><Text style={[styles.choiceText, { color: readingTheme.secondary }, value === key && styles.activeText]}>{label}</Text></Pressable>)}</View></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, header: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth }, back: { color: colors.primary, fontSize: 13 }, title: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' }, space: { width: 40 },
  content: { padding: spacing.xl, paddingBottom: spacing.xxxl }, note: { marginTop: spacing.sm, fontSize: 12, lineHeight: 20 }, introNote: { marginTop: 0 }, block: { marginTop: spacing.xl }, blockTitle: { marginBottom: spacing.sm, fontSize: 11 }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, choice: { minHeight: 34, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radii.pill }, active: { backgroundColor: colors.primary }, choiceText: { fontSize: 11 }, activeText: { color: '#fff', fontWeight: '700' }, privacy: { marginTop: spacing.xl, padding: spacing.lg, borderRadius: radii.lg }, privacyTitle: { fontSize: 13, fontWeight: '600' },
  primary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xxl, borderRadius: radii.pill, backgroundColor: colors.primary }, primaryText: { color: '#fff', fontSize: 13, fontWeight: '700' }, disabled: { opacity: 0.55 },
});
