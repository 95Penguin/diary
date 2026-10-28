import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getSleepRecordBounds, getSleepRecordMonthCounts, listSleepRecords, sleepNightDate, type SleepRecord } from '@/database/sleep-repository';
import { localDateKey } from '@/utils/entry-time-range';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

const DAY_MS = 24 * 60 * 60 * 1000;
const CLOCK_START = 18 * 60;
const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
const pad = (value: number) => String(value).padStart(2, '0');
const monthStart = (year: number, month: number) => `${year}-${pad(month)}-01`;
const nextMonthStart = (year: number, month: number) => monthStart(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1);

function localMinutes(value: string) {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes();
}

function clockOffset(value: string) {
  return (localMinutes(value) - CLOCK_START + 24 * 60) % (24 * 60);
}

function formatClock(minutes: number | null) {
  if (minutes === null) return '—';
  const normalized = ((Math.round(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function averageOffset(records: SleepRecord[]) {
  if (!records.length) return null;
  return records.reduce((total, record) => total + clockOffset(record.occurredAt), 0) / records.length;
}

function averageClock(records: SleepRecord[]) {
  const average = averageOffset(records);
  return average === null ? null : (average + CLOCK_START) % (24 * 60);
}

function periodStart(today: Date, daysBack: number) {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysBack);
  return localDateKey(date);
}

export default function SleepStatsScreen() {
  const db = useSQLiteContext();
  const { readingTheme } = useAppPreferences();
  const [records, setRecords] = useState<SleepRecord[]>([]);
  const [selectedRecords, setSelectedRecords] = useState<SleepRecord[]>([]);
  const [previousRecords, setPreviousRecords] = useState<SleepRecord[]>([]);
  const [monthCounts, setMonthCounts] = useState<Record<string, number>>({});
  const [firstYear, setFirstYear] = useState(() => new Date().getFullYear());
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerYear, setPickerYear] = useState(selectedYear);
  const [pickerMonth, setPickerMonth] = useState(selectedMonth);
  const [anchorNight, setAnchorNight] = useState(() => sleepNightDate(new Date()));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [plotWidth, setPlotWidth] = useState(0);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestId.current;
    const today = new Date();
    const nightKey = sleepNightDate(today);
    const nightDate = new Date(`${nightKey}T12:00:00`);
    nightDate.setDate(nightDate.getDate() + 1);
    setLoading(true);
    setLoadError(false);
    try {
      const previousMonth = new Date(selectedYear, selectedMonth - 2, 1);
      const [items, monthItems, beforeItems, counts, bounds] = await Promise.all([
        listSleepRecords(db, periodStart(nightDate, 60), localDateKey(nightDate)),
        listSleepRecords(db, monthStart(selectedYear, selectedMonth), nextMonthStart(selectedYear, selectedMonth)),
        listSleepRecords(db, monthStart(previousMonth.getFullYear(), previousMonth.getMonth() + 1), monthStart(selectedYear, selectedMonth)),
        getSleepRecordMonthCounts(db),
        getSleepRecordBounds(db),
      ]);
      if (request === requestId.current) {
        setRecords(items);
        setSelectedRecords(monthItems);
        setPreviousRecords(beforeItems);
        setMonthCounts(counts);
        setFirstYear(bounds?.first_date ? Number(bounds.first_date.slice(0, 4)) : new Date().getFullYear());
        setAnchorNight(nightKey);
      }
    } catch {
      if (request === requestId.current) setLoadError(true);
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [db, selectedMonth, selectedYear]);

  function changeMonth(delta: number) {
    const next = new Date(selectedYear, selectedMonth - 1 + delta, 1);
    const now = new Date();
    if (next.getFullYear() > now.getFullYear() || (next.getFullYear() === now.getFullYear() && next.getMonth() > now.getMonth())) return;
    setSelectedYear(next.getFullYear()); setSelectedMonth(next.getMonth() + 1);
  }

  function openMonthPicker() { setPickerYear(selectedYear); setPickerMonth(selectedMonth); setPickerVisible(true); }
  function confirmMonthPicker() { setSelectedYear(pickerYear); setSelectedMonth(pickerMonth); setPickerVisible(false); }

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const summary = useMemo(() => {
    const today = new Date(`${anchorNight}T12:00:00`);
    const sevenDayStart = periodStart(today, 6);
    const thirtyDayStart = periodStart(today, 29);
    const week = records.filter((record) => record.nightDate >= sevenDayStart && record.nightDate <= anchorNight);
    const month = records.filter((record) => record.nightDate >= thirtyDayStart && record.nightDate <= anchorNight);
    const sevenDayAverage = averageClock(week);
    const thirtyDayAverage = averageClock(month);
    const previousAverage = averageOffset(previousRecords);
    const currentAverage = averageOffset(selectedRecords);
    const difference = currentAverage === null || previousAverage === null ? null : Math.round(currentAverage - previousAverage);
    const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
    const trend = Array.from({ length: daysInMonth }, (_, index) => {
      const key = `${selectedYear}-${pad(selectedMonth)}-${pad(index + 1)}`;
      const record = selectedRecords.find((item) => item.nightDate === key);
      return { key, record, value: record ? clockOffset(record.occurredAt) : null };
    });
    return { week, month, sevenDayAverage, thirtyDayAverage, difference, trend, selectedAverage: averageClock(selectedRecords) };
  }, [anchorNight, previousRecords, records, selectedMonth, selectedRecords, selectedYear]);

  const chartRange = useMemo(() => {
    const values = summary.trend.flatMap((item) => item.value === null ? [] : [item.value]);
    const low = values.length ? Math.min(...values) : 6 * 60;
    const high = values.length ? Math.max(...values) : 10 * 60;
    const center = (low + high) / 2;
    const span = Math.min(24 * 60, Math.max(8 * 60, high - low + 2 * 60));
    const start = Math.max(0, Math.min(24 * 60 - span, Math.floor((center - span / 2) / 60) * 60));
    const end = start + span;
    return { start, end };
  }, [summary.trend]);

  const points = useMemo(() => {
    const height = 72;
    return summary.trend.map((item, index) => ({
      ...item,
      x: summary.trend.length <= 1 ? plotWidth / 2 : (index / (summary.trend.length - 1)) * plotWidth,
      y: item.value === null ? null : 4 + ((item.value - chartRange.start) / (chartRange.end - chartRange.start)) * (height - 8),
    }));
  }, [chartRange, plotWidth, summary.trend]);

  const comparison = summary.difference === null
    ? selectedRecords.length ? '上月暂无记录可比较' : '本月暂无记录'
    : Math.abs(summary.difference) < 5
      ? '与上月接近'
      : `较上月${summary.difference > 0 ? '推迟' : '提前'} ${Math.abs(summary.difference)} 分钟`;

  return <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="返回" hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable>
      <Text style={[styles.title, { color: readingTheme.text }]}>睡眠统计</Text>
      <View style={styles.headerSpace} />
    </View>

    {loading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : loadError ? <View style={styles.message}><Text style={[styles.messageText, { color: readingTheme.secondary }]}>暂时无法读取睡眠记录</Text><Pressable onPress={() => void load()}><Text style={styles.retry}>重新加载</Text></Pressable></View> : <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.metricRow}>
        <MetricCard title="近 7 晚平均" value={formatClock(summary.sevenDayAverage)} detail={`${summary.week.length} / 7 晚有记录`} backgroundColor={readingTheme.surface} textColor={readingTheme.text} secondaryColor={readingTheme.secondary} />
        <MetricCard title="近 30 晚平均" value={formatClock(summary.thirtyDayAverage)} detail={`${summary.month.length} / 30 晚有记录`} backgroundColor={readingTheme.surface} textColor={readingTheme.text} secondaryColor={readingTheme.secondary} />
      </View>

      <View style={styles.monthNav}>
        <Pressable accessibilityRole="button" accessibilityLabel="上一个月" onPress={() => changeMonth(-1)} style={[styles.monthArrow, { backgroundColor: readingTheme.surface }]}><Text style={styles.monthArrowText}>‹</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="选择统计月份" onPress={openMonthPicker} style={styles.monthSelect}><Text style={[styles.monthTitle, { color: readingTheme.text }]}>{selectedYear}年{selectedMonth}月</Text><SymbolView name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }} size={13} tintColor={colors.primary} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="下一个月" disabled={selectedYear === new Date().getFullYear() && selectedMonth === new Date().getMonth() + 1} onPress={() => changeMonth(1)} style={[styles.monthArrow, { backgroundColor: readingTheme.surface }, selectedYear === new Date().getFullYear() && selectedMonth === new Date().getMonth() + 1 && styles.disabled]}><Text style={styles.monthArrowText}>›</Text></Pressable>
      </View>

      <View style={[styles.chartCard, { backgroundColor: readingTheme.surface }]}>
        <View style={styles.chartHeader}><Text style={[styles.chartTitle, { color: readingTheme.text }]}>{selectedRecords.length ? `${selectedRecords.length} 晚 · 平均 ${formatClock(summary.selectedAverage)}` : '入睡时间'}</Text>{selectedRecords.length ? <Text style={[styles.chartNote, { color: readingTheme.secondary }]}>{comparison}</Text> : null}</View>
        {selectedRecords.length ? <View style={styles.chartBody}>
          <View style={styles.axisLabels}>{[0, 0.25, 0.5, 0.75, 1].map((ratio) => <Text key={ratio} style={[styles.axisLabel, { color: readingTheme.secondary }]}>{formatClock(CLOCK_START + chartRange.start + (chartRange.end - chartRange.start) * ratio)}</Text>)}</View>
          <View style={styles.plot} onLayout={(event) => setPlotWidth(Math.max(0, event.nativeEvent.layout.width))}>
            {[0, 1, 2, 3, 4].map((line) => <View key={line} style={[styles.gridLine, { top: 4 + line * 16, backgroundColor: readingTheme.border }]} />)}
            {points.slice(0, -1).map((point, index) => {
              const next = points[index + 1];
              if (point.y === null || next.y === null) return null;
              const dx = next.x - point.x;
              const dy = next.y - point.y;
              return <View key={`${point.key}-line`} style={[styles.line, { left: point.x, top: point.y, width: Math.sqrt(dx * dx + dy * dy), backgroundColor: colors.primary, transform: [{ rotateZ: `${Math.atan2(dy, dx)}rad` }] }]} />;
            })}
            {points.map((point) => point.y === null ? null : <View key={point.key} accessibilityLabel={`${point.key} ${formatClock(point.record ? localMinutes(point.record.occurredAt) : null)}`} style={[styles.point, { left: point.x - 3, top: point.y - 3, backgroundColor: colors.primary, borderColor: readingTheme.surface }]} />)}
          </View>
        </View> : <Text style={[styles.emptyText, { color: readingTheme.secondary }]}>这个月还没有记录</Text>}
        {selectedRecords.length ? <View style={styles.dateLabels}><Text style={[styles.dateLabel, { color: readingTheme.secondary }]}>1 日</Text><Text style={[styles.dateLabel, { color: readingTheme.secondary }]}>月中</Text><Text style={[styles.dateLabel, { color: readingTheme.secondary }]}>{summary.trend.length} 日</Text></View> : null}
      </View>

      <Pressable accessibilityRole="button" onPress={() => router.push(`/sleep-log/history?year=${selectedYear}&month=${selectedMonth}` as Href)} style={[styles.historyLink, { backgroundColor: readingTheme.surface }]}><Text style={styles.historyLinkText}>查看本月记录</Text><SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={16} tintColor={colors.primary} /></Pressable>
    </ScrollView>}

    <Modal transparent animationType="fade" visible={pickerVisible} onRequestClose={() => setPickerVisible(false)}>
      <Pressable style={styles.overlay} onPress={() => setPickerVisible(false)}>
        <Pressable style={[styles.pickerCard, { backgroundColor: readingTheme.surface }]} onPress={(event) => event.stopPropagation()}>
          <Text style={[styles.pickerTitle, { color: readingTheme.text }]}>选择年月</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.yearStrip}>{Array.from({ length: Math.max(1, new Date().getFullYear() - firstYear + 1) }, (_, index) => new Date().getFullYear() - index).map((item) => <Pressable key={item} onPress={() => { setPickerYear(item); if (item === new Date().getFullYear() && pickerMonth > new Date().getMonth() + 1) setPickerMonth(new Date().getMonth() + 1); }} style={[styles.yearChip, { backgroundColor: readingTheme.background }, pickerYear === item && styles.chipActive]}><Text style={[styles.yearText, { color: pickerYear === item ? '#FFF' : readingTheme.text }]}>{item}</Text></Pressable>)}</ScrollView>
          <View style={styles.monthGrid}>{MONTHS.map((item) => {
            const future = pickerYear === new Date().getFullYear() && item > new Date().getMonth() + 1;
            const selected = pickerMonth === item;
            const count = monthCounts[`${pickerYear}-${pad(item)}`] ?? 0;
            return <Pressable key={item} accessibilityRole="button" accessibilityLabel={`${pickerYear}年${item}月，${count}晚有记录`} disabled={future} onPress={() => setPickerMonth(item)} style={[styles.monthChip, { backgroundColor: readingTheme.background }, selected && styles.chipActive, future && styles.disabled]}><Text style={[styles.monthText, { color: selected ? '#FFF' : readingTheme.text }]}>{item}月</Text>{count ? <View style={[styles.monthDot, { backgroundColor: selected ? '#FFF' : colors.primary }]} /> : null}</Pressable>;
          })}</View>
          <View style={styles.pickerActions}><Pressable onPress={() => setPickerVisible(false)} style={styles.pickerCancel}><Text style={[styles.pickerCancelText, { color: readingTheme.secondary }]}>取消</Text></Pressable><Pressable onPress={confirmMonthPicker} style={styles.pickerConfirm}><Text style={styles.pickerConfirmText}>查看</Text></Pressable></View>
        </Pressable>
      </Pressable>
    </Modal>
  </SafeAreaView>;
}

function MetricCard({ title, value, detail, backgroundColor, textColor, secondaryColor }: { title: string; value: string; detail: string; backgroundColor: string; textColor: string; secondaryColor: string }) {
  return <View style={[styles.metricCard, { backgroundColor }]}>
    <Text style={[styles.metricTitle, { color: secondaryColor }]}>{title}</Text>
    <Text style={[styles.metricValue, { color: textColor }]}>{value}</Text>
    <Text style={[styles.metricDetail, { color: secondaryColor }]}>{detail}</Text>
  </View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { color: colors.primary, fontSize: 13 }, title: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, headerSpace: { width: 42 },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: 28, gap: spacing.md },
  metricRow: { flexDirection: 'row', gap: spacing.sm }, metricCard: { flex: 1, minWidth: 0, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.lg }, metricTitle: { fontSize: 10 }, metricValue: { marginTop: 2, fontFamily: fonts.serif, fontSize: 21, fontWeight: '600', fontVariant: ['tabular-nums'] }, metricDetail: { marginTop: 1, fontSize: 10 },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, monthArrow: { width: 34, height: 34, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' }, monthArrowText: { color: colors.primary, fontSize: 23, lineHeight: 26 }, monthSelect: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md }, monthTitle: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '600' }, disabled: { opacity: 0.35 },
  chartCard: { padding: spacing.md, borderRadius: radii.lg }, chartHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm }, chartTitle: { fontSize: 12, fontWeight: '700' }, chartNote: { flexShrink: 1, fontSize: 10, textAlign: 'right' }, chartBody: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }, axisLabels: { height: 72, justifyContent: 'space-between' }, axisLabel: { fontSize: 10, lineHeight: 12 }, plot: { flex: 1, height: 72, position: 'relative' }, gridLine: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth }, line: { position: 'absolute', height: 1.5, transformOrigin: 'left center' }, point: { position: 'absolute', width: 6, height: 6, borderRadius: 3, borderWidth: 1 }, dateLabels: { flexDirection: 'row', justifyContent: 'space-between', marginLeft: 44, marginTop: spacing.xs }, dateLabel: { fontSize: 10 }, emptyText: { paddingVertical: spacing.lg, fontSize: 11 },
  historyLink: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, borderRadius: radii.lg }, historyLinkText: { color: colors.primary, fontSize: 11, fontWeight: '600' }, loader: { flex: 1 }, message: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm }, messageText: { fontSize: 12 }, retry: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl, backgroundColor: colors.overlay }, pickerCard: { width: '100%', maxWidth: 390, borderRadius: radii.lg, padding: spacing.lg }, pickerTitle: { textAlign: 'center', fontFamily: fonts.serif, fontSize: 16, fontWeight: '600' }, yearStrip: { gap: spacing.sm, paddingVertical: spacing.md }, yearChip: { minWidth: 58, minHeight: 34, paddingHorizontal: spacing.md, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' }, chipActive: { backgroundColor: colors.primary }, yearText: { fontSize: 11, fontWeight: '600' }, monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'space-between' }, monthChip: { width: '22%', minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md }, monthText: { fontSize: 11 }, monthDot: { position: 'absolute', bottom: 4, width: 4, height: 4, borderRadius: 2 }, pickerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm }, pickerCancel: { minHeight: 40, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' }, pickerCancelText: { fontSize: 12 }, pickerConfirm: { minHeight: 40, paddingHorizontal: spacing.lg, borderRadius: radii.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, pickerConfirmText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
});
