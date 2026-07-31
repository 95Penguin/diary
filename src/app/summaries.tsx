import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  getStatisticsOverview,
  getStatisticsYearHeatmap,
  type StatisticsHeatmapDay,
  type StatisticsOverview,
  type StatisticsPeriod,
  type StatisticsRankingItem,
  type StatisticsTrendItem,
} from '@/database/statistics-repository';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

const PERIODS: { value: StatisticsPeriod; label: string }[] = [
  { value: 'week', label: '周总结' },
  { value: 'month', label: '月总结' },
  { value: 'year', label: '年度总结' },
];

const TOTALS: {
  key: keyof StatisticsOverview['current']['totals'];
  label: string;
}[] = [
  { key: 'entries', label: '记录' },
  { key: 'media', label: '媒体' },
  { key: 'followUps', label: '后续' },
  { key: 'tags', label: '标签' },
  { key: 'locations', label: '地点' },
  { key: 'moods', label: '心情' },
];

function validPeriod(value: string | string[] | undefined): StatisticsPeriod {
  return value === 'week' || value === 'year' ? value : 'month';
}

function formatRange(period: StatisticsPeriod, start: string, end: string) {
  const from = new Date(start);
  const to = new Date(end);
  to.setMilliseconds(to.getMilliseconds() - 1);
  if (period === 'year') return `${from.getFullYear()} 年`;
  if (period === 'month') return `${from.getFullYear()} 年 ${from.getMonth() + 1} 月`;
  return `${from.getMonth() + 1}月${from.getDate()}日 – ${to.getMonth() + 1}月${to.getDate()}日`;
}

function periodOffsetAnchor(period: StatisticsPeriod, anchor: Date, offset: number) {
  const next = new Date(anchor);
  if (period === 'week') next.setDate(next.getDate() + offset * 7);
  else if (period === 'month') next.setMonth(next.getMonth() + offset);
  else next.setFullYear(next.getFullYear() + offset);
  return next;
}

function trendLabel(period: StatisticsPeriod, key: string) {
  if (period === 'year') return `${Number(key.slice(5))}月`;
  const date = new Date(`${key}T12:00:00`);
  return period === 'week'
    ? ['日', '一', '二', '三', '四', '五', '六'][date.getDay()]
    : String(date.getDate());
}

function changeLabel(difference: number, percentChange: number | null) {
  if (difference === 0) return '与上一周期持平';
  const direction = difference > 0 ? '增加' : '减少';
  const amount = Math.abs(difference);
  return percentChange === null
    ? `较上一周期${direction} ${amount}`
    : `较上一周期${direction} ${amount} · ${Math.abs(percentChange).toFixed(0)}%`;
}

function compactDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value.includes('T') ? value : `${value}T12:00:00`);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export default function SummariesScreen() {
  const db = useSQLiteContext();
  const params = useLocalSearchParams<{ period?: string }>();
  const { readingTheme, readingFontFamily, fontScale } = useAppPreferences();
  const [period, setPeriod] = useState<StatisticsPeriod>(() => validPeriod(params.period));
  const [anchor, setAnchor] = useState(() => new Date());
  const [overview, setOverview] = useState<StatisticsOverview | null>(null);
  const [heatmap, setHeatmap] = useState<StatisticsHeatmapDay[]>([]);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const [nextOverview, nextHeatmap] = await Promise.all([
        getStatisticsOverview(db, { period, anchor, rankingLimit: 6 }),
        period === 'year' ? getStatisticsYearHeatmap(db, anchor) : Promise.resolve([]),
      ]);
      if (currentRequest === requestId.current) {
        setOverview(nextOverview);
        setHeatmap(nextHeatmap);
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [anchor, db, period]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const narrative = useMemo(() => {
    if (!overview) return '';
    const { entries, media, followUps } = overview.current.totals;
    if (!entries && !followUps) return '这一段时间还没有记录，留白也是生活的一部分。';
    const topMood = overview.current.rankings.moods[0]?.label;
    const pieces = [`写下 ${entries} 条记录`];
    if (media) pieces.push(`留下 ${media} 个媒体`);
    if (followUps) pieces.push(`补充 ${followUps} 条后续`);
    return `${pieces.join('，')}。${topMood ? `最常出现的心情是“${topMood}”。` : ''}`;
  }, [overview]);

  function selectPeriod(next: StatisticsPeriod) {
    setOverview(null);
    setPeriod(next);
    setAnchor(new Date());
  }

  function movePeriod(offset: number) {
    setOverview(null);
    setAnchor((value) => periodOffsetAnchor(period, value, offset));
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: readingTheme.background }]}>
      <View style={[styles.header, { borderBottomColor: readingTheme.border }]}>
        <Pressable accessibilityLabel="返回" hitSlop={12} onPress={() => router.back()}>
          <Text style={styles.back}>‹ 返回</Text>
        </Pressable>
        <Text style={[styles.title, { color: readingTheme.text }]}>时光总结</Text>
        <View style={styles.headerSpace} />
      </View>

      <View style={[styles.segmented, { backgroundColor: readingTheme.surface }]}>
        {PERIODS.map((item) => (
          <Pressable
            key={item.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: period === item.value }}
            onPress={() => selectPeriod(item.value)}
            style={[styles.segment, period === item.value && styles.segmentActive]}
          >
            <Text style={[
              styles.segmentText,
              { color: readingTheme.secondary },
              period === item.value && styles.segmentTextActive,
            ]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.periodNavigation}>
        <Pressable accessibilityLabel="上一周期" hitSlop={10} onPress={() => movePeriod(-1)}>
          <Text style={styles.periodArrow}>‹</Text>
        </Pressable>
        <Text style={[styles.periodTitle, { color: readingTheme.text }]}>
          {overview ? formatRange(period, overview.current.range.start, overview.current.range.end) : ' '}
        </Text>
        <Pressable accessibilityLabel="下一周期" hitSlop={10} onPress={() => movePeriod(1)}>
          <Text style={styles.periodArrow}>›</Text>
        </Pressable>
      </View>

      {loading && !overview ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : overview ? (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={[styles.hero, { backgroundColor: readingTheme.surface }]}>
            <Text style={[styles.heroEyebrow, { color: readingTheme.secondary }]}>这一段日子的轮廓</Text>
            <Text style={[
              styles.heroText,
              {
                color: readingTheme.text,
                fontFamily: readingFontFamily,
                fontSize: 13 * fontScale,
                lineHeight: 20 * fontScale,
              },
            ]}>{narrative}</Text>
          </View>

          <Text style={[styles.sectionTitle, { color: readingTheme.text }]}>总览</Text>
          <View style={[styles.totalGrid, { backgroundColor: readingTheme.surface }]}>
            {TOTALS.map(({ key, label }) => (
              <View key={key} style={styles.totalCell}>
                <Text style={[styles.totalValue, { color: readingTheme.text }]}>{overview.current.totals[key]}</Text>
                <Text style={[styles.totalLabel, { color: readingTheme.secondary }]}>{label}</Text>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.totalChange,
                    { color: overview.comparison[key].difference >= 0 ? colors.primary : readingTheme.secondary },
                  ]}
                >
                  {changeLabel(
                    overview.comparison[key].difference,
                    overview.comparison[key].percentChange,
                  )}
                </Text>
              </View>
            ))}
          </View>

          <Text style={[styles.sectionTitle, { color: readingTheme.text }]}>本期高光</Text>
          <View style={[styles.highlightGrid, { backgroundColor: readingTheme.surface }]}>
            <Highlight
              label="最晚落笔"
              value={overview.current.highlights.latestWritingTime ?? '—'}
              detail="一天中最晚的记录时间"
            />
            <Highlight
              label="记录最多"
              value={compactDate(overview.current.highlights.busiestDay?.key)}
              detail={overview.current.highlights.busiestDay
                ? `${overview.current.highlights.busiestDay.count} 条记录`
                : '还没有记录'}
            />
            <Highlight
              label="最长一篇"
              value={`${overview.current.highlights.longestEntry?.characters ?? 0} 字`}
              detail={compactDate(overview.current.highlights.longestEntry?.occurredAt)}
            />
            <Highlight
              label="周期总字数"
              value={`${overview.current.highlights.totalCharacters} 字`}
              detail="仅统计记录正文"
            />
          </View>

          <Text style={[styles.sectionTitle, { color: readingTheme.text }]}>记录趋势</Text>
          <TrendChart period={period} data={overview.current.trend} />

          <Text style={[styles.sectionTitle, { color: readingTheme.text }]}>常出现的内容</Text>
          <View style={styles.rankingStack}>
            <RankingCard title="标签" items={overview.current.rankings.tags} emptyText="还没有使用标签" />
            <RankingCard title="地点" items={overview.current.rankings.locations} emptyText="还没有记录地点" />
            <RankingCard title="心情" items={overview.current.rankings.moods} emptyText="还没有记录心情" />
          </View>

          {period === 'year' ? (
            <>
              <Text style={[styles.sectionTitle, { color: readingTheme.text }]}>全年记录</Text>
              <YearHeatmap data={heatmap} year={new Date(overview.current.range.start).getFullYear()} />
            </>
          ) : null}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function Highlight({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  const { readingTheme } = useAppPreferences();
  return (
    <View style={styles.highlightCell}>
      <Text style={styles.highlightLabel}>{label}</Text>
      <Text numberOfLines={1} style={[styles.highlightValue, { color: readingTheme.text }]}>
        {value}
      </Text>
      <Text numberOfLines={1} style={[styles.highlightDetail, { color: readingTheme.secondary }]}>
        {detail}
      </Text>
    </View>
  );
}

function TrendChart({ period, data }: { period: StatisticsPeriod; data: StatisticsTrendItem[] }) {
  const { readingTheme } = useAppPreferences();
  const [width, setWidth] = useState(0);
  const values = data.map((item) => item.entries);
  const max = Math.max(1, ...values);
  const chartWidth = Math.max(0, width - 24);
  const height = 96;
  const points = values.map((value, index) => ({
    x: data.length <= 1 ? chartWidth / 2 : (index / (data.length - 1)) * chartWidth,
    y: 10 + (1 - value / max) * (height - 28),
    value,
  }));
  const labelStep = period === 'month' ? 5 : 1;

  return (
    <View
      style={[styles.chartCard, { backgroundColor: readingTheme.surface }]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      <View style={[styles.chartPlot, { height }]}>
        {[0, 1, 2].map((line) => (
          <View
            key={line}
            style={[
              styles.chartGridLine,
              { top: 10 + line * 31, backgroundColor: readingTheme.border },
            ]}
          />
        ))}
        {points.slice(0, -1).map((point, index) => {
          const next = points[index + 1];
          const dx = next.x - point.x;
          const dy = next.y - point.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          return (
            <View
              key={`${data[index].key}-line`}
              style={[
                styles.chartLine,
                {
                  left: 12 + point.x,
                  top: point.y,
                  width: length,
                  transform: [{ rotateZ: `${Math.atan2(dy, dx)}rad` }],
                },
              ]}
            />
          );
        })}
        {points.map((point, index) => (
          <View
            key={data[index].key}
            accessibilityLabel={`${trendLabel(period, data[index].key)}，${point.value}条记录`}
            style={[styles.chartPoint, { left: 9 + point.x, top: point.y - 3 }]}
          />
        ))}
      </View>
      <View style={styles.chartLabels}>
        {data.map((item, index) => (
          <Text
            key={item.key}
            style={[
              styles.chartLabel,
              { color: readingTheme.secondary },
              index % labelStep !== 0 && index !== data.length - 1 && styles.hiddenLabel,
            ]}
          >{trendLabel(period, item.key)}</Text>
        ))}
      </View>
      <View style={styles.chartLegend}>
        <View style={styles.legendDot} />
        <Text style={[styles.legendLabel, { color: readingTheme.secondary }]}>每日记录数量</Text>
      </View>
    </View>
  );
}

function RankingCard({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: StatisticsRankingItem[];
  emptyText: string;
}) {
  const { readingTheme } = useAppPreferences();
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <View style={[styles.rankingCard, { backgroundColor: readingTheme.surface }]}>
      <Text style={[styles.rankingTitle, { color: readingTheme.text }]}>{title}</Text>
      {items.length ? items.slice(0, 5).map((item, index) => (
        <View key={item.label} style={styles.rankingRow}>
          <Text numberOfLines={1} style={[styles.rankingLabel, { color: readingTheme.secondary }]}>
            {index + 1}. {item.label}
          </Text>
          <View style={[styles.rankingTrack, { backgroundColor: readingTheme.border }]}>
            <View style={[styles.rankingFill, { width: `${Math.max(8, item.count / max * 100)}%` }]} />
          </View>
          <Text style={[styles.rankingCount, { color: readingTheme.text }]}>{item.count}</Text>
        </View>
      )) : <Text style={[styles.rankingEmpty, { color: readingTheme.secondary }]}>{emptyText}</Text>}
    </View>
  );
}

function YearHeatmap({ data, year }: { data: StatisticsHeatmapDay[]; year: number }) {
  const { readingTheme } = useAppPreferences();
  const counts = useMemo(() => new Map(data.map((item) => [item.key, item.count])), [data]);
  const weeks = useMemo(() => {
    const start = new Date(year, 0, 1);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(year, 11, 31);
    const result: Date[][] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const week: Date[] = [];
      for (let index = 0; index < 7; index += 1) {
        week.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
      result.push(week);
    }
    return result;
  }, [year]);
  const keyFor = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  return (
    <View style={[styles.heatCard, { backgroundColor: readingTheme.surface }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={styles.heatMonths}>
            {Array.from({ length: 12 }, (_, month) => {
              const index = weeks.findIndex((week) => week.some((day) => day.getFullYear() === year && day.getMonth() === month && day.getDate() === 1));
              return <Text key={month} style={[styles.heatMonth, { left: Math.max(0, index) * 11, color: readingTheme.secondary }]}>{month + 1}月</Text>;
            })}
          </View>
          <View style={styles.heatGrid}>
            {weeks.map((week, weekIndex) => (
              <View key={weekIndex} style={styles.heatWeek}>
                {week.map((date) => {
                  const outside = date.getFullYear() !== year;
                  const count = outside ? 0 : counts.get(keyFor(date)) ?? 0;
                  return (
                    <View
                      key={date.toISOString()}
                      accessibilityLabel={!outside ? `${date.getMonth() + 1}月${date.getDate()}日，${count}条记录` : undefined}
                      style={[
                        styles.heatCell,
                        { backgroundColor: readingTheme.border },
                        outside && styles.heatOutside,
                        count === 1 && styles.heatOne,
                        count === 2 && styles.heatTwo,
                        count >= 3 && styles.heatMany,
                      ]}
                    />
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
      <View style={styles.heatLegend}>
        <Text style={[styles.heatLegendText, { color: readingTheme.secondary }]}>少</Text>
        <View style={[styles.heatCell, { backgroundColor: readingTheme.border }]} />
        <View style={[styles.heatCell, styles.heatOne]} />
        <View style={[styles.heatCell, styles.heatTwo]} />
        <View style={[styles.heatCell, styles.heatMany]} />
        <Text style={[styles.heatLegendText, { color: readingTheme.secondary }]}>多</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { color: colors.primary, fontSize: 13 },
  title: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' },
  headerSpace: { width: 42 },
  segmented: { flexDirection: 'row', marginHorizontal: spacing.xl, marginTop: spacing.sm, padding: 2, borderRadius: radii.pill },
  segment: { flex: 1, minHeight: 30, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: { fontSize: 11, fontWeight: '600' },
  segmentTextActive: { color: '#FFFFFF', fontWeight: '700' },
  periodNavigation: { height: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xxl },
  periodArrow: { color: colors.primary, fontSize: 26, lineHeight: 30 },
  periodTitle: { fontFamily: fonts.serif, fontSize: 15, fontWeight: '600' },
  loader: { marginTop: 100 },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: 36 },
  hero: { padding: spacing.md, borderRadius: radii.lg },
  heroEyebrow: { fontSize: 9 },
  heroText: { marginTop: spacing.xs, fontFamily: fonts.serif, fontSize: 13, lineHeight: 20 },
  sectionTitle: { marginTop: spacing.md, marginBottom: spacing.xs, fontFamily: fonts.serif, fontSize: 14, fontWeight: '600' },
  totalGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: spacing.md, borderRadius: radii.lg },
  totalCell: { width: '33.333%', minHeight: 68, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  totalValue: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 20 },
  totalLabel: { marginTop: 2, fontSize: 9, lineHeight: 12 },
  totalChange: { maxWidth: '100%', marginTop: 4, fontSize: 9, lineHeight: 12, textAlign: 'center' },
  highlightGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: spacing.md, borderRadius: radii.lg },
  highlightCell: { width: '50%', minHeight: 76, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  highlightLabel: { color: colors.primary, fontSize: 10, lineHeight: 13, fontWeight: '700', textAlign: 'center' },
  highlightValue: { marginTop: 2, fontFamily: fonts.serif, fontSize: 14, lineHeight: 18, textAlign: 'center' },
  highlightDetail: { marginTop: 3, fontSize: 9, lineHeight: 12, textAlign: 'center' },
  chartCard: { padding: spacing.sm, borderRadius: radii.lg, overflow: 'hidden' },
  chartPlot: { position: 'relative', paddingHorizontal: 12 },
  chartGridLine: { position: 'absolute', left: 12, right: 12, height: StyleSheet.hairlineWidth },
  chartLine: { position: 'absolute', height: 2, borderRadius: 1, backgroundColor: colors.primary, transformOrigin: 'left center' },
  chartPoint: { position: 'absolute', width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: colors.primary },
  chartLabels: { flexDirection: 'row', justifyContent: 'space-between', minHeight: 14 },
  chartLabel: { flex: 1, fontSize: 8, textAlign: 'center' },
  hiddenLabel: { opacity: 0 },
  chartLegend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: spacing.xs },
  legendDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  legendLabel: { fontSize: 9 },
  rankingStack: { gap: spacing.xs },
  rankingCard: { padding: spacing.sm, borderRadius: radii.lg },
  rankingTitle: { marginBottom: spacing.xs, fontSize: 10, fontWeight: '700' },
  rankingRow: { minHeight: 21, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rankingLabel: { width: 82, fontSize: 9 },
  rankingTrack: { flex: 1, height: 7, borderRadius: radii.pill, overflow: 'hidden' },
  rankingFill: { height: '100%', borderRadius: radii.pill, backgroundColor: colors.primary },
  rankingCount: { width: 24, fontSize: 9, textAlign: 'right' },
  rankingEmpty: { paddingVertical: spacing.sm, fontSize: 9 },
  heatCard: { padding: spacing.sm, borderRadius: radii.lg },
  heatMonths: { position: 'relative', height: 16 },
  heatMonth: { position: 'absolute', width: 28, fontSize: 8 },
  heatGrid: { flexDirection: 'row', gap: 3 },
  heatWeek: { gap: 3 },
  heatCell: { width: 8, height: 8, borderRadius: 2 },
  heatOutside: { opacity: 0 },
  heatOne: { backgroundColor: '#B9D0C3' },
  heatTwo: { backgroundColor: '#76A08D' },
  heatMany: { backgroundColor: colors.primary },
  heatLegend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: spacing.sm },
  heatLegendText: { fontSize: 9 },
  exportHint: { marginTop: spacing.md, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg },
  exportHintTitle: { fontSize: 11, fontWeight: '700' },
  exportHintText: { marginTop: spacing.xs, fontSize: 10 },
});
