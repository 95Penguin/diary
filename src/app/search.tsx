import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { EmptyState } from '@/components/empty-state';
import { searchEntries } from '@/database/journal-repository';
import type { SearchResult } from '@/domain/journal';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { formatShortDateTime } from '@/utils/date';

type TimeFilter = 'all' | 'today' | '7d' | '30d';
const FILTERS: { value: TimeFilter; label: string }[] = [
  { value: 'all', label: '全部时间' }, { value: 'today', label: '今天' }, { value: '7d', label: '近 7 天' }, { value: '30d', label: '近 30 天' },
];

export default function SearchScreen() {
  const db = useSQLiteContext();
  const [query, setQuery] = useState('');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (value: string, filter: TimeFilter) => {
    if (!value.trim()) { setResults([]); setLoading(false); return; }
    setLoading(true);
    try { setResults(await searchEntries(db, value, dateRange(filter))); } finally { setLoading(false); }
  }, [db]);

  useEffect(() => {
    const timer = setTimeout(() => void search(query, timeFilter), 250);
    return () => clearTimeout(timer);
  }, [query, search, timeFilter]);

  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.header}><Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.back}>‹</Text></Pressable><Text style={styles.title}>搜索</Text><View style={styles.headerSpace} /></View>
    <View style={styles.searchBox}><Text style={styles.icon}>⌕</Text><TextInput autoFocus value={query} onChangeText={setQuery} placeholder="搜索记录、后续与标签" placeholderTextColor={colors.textFaint} returnKeyType="search" style={styles.input} />{query ? <Pressable onPress={() => setQuery('')}><Text style={styles.clear}>×</Text></Pressable> : null}</View>
    <ScrollView horizontal style={styles.filterScroll} contentContainerStyle={styles.filters} showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {FILTERS.map((filter) => <Pressable key={filter.value} onPress={() => setTimeFilter(filter.value)} style={[styles.filter, timeFilter === filter.value && styles.filterActive]}><Text style={[styles.filterText, timeFilter === filter.value && styles.filterTextActive]}>{filter.label}</Text></Pressable>)}
    </ScrollView>
    {loading ? <ActivityIndicator style={styles.loader} color={colors.primary} /> : !query.trim() ? <EmptyState title="找回一段记忆" description="输入正文、后续或标签中出现过的词。" /> : results.length ? (
      <ScrollView contentContainerStyle={styles.results} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.resultCount}>找到 {results.length} 条相关记录</Text>
        {results.map((result) => <SearchResultCard key={result.entry.id} result={result} query={query.trim()} />)}
      </ScrollView>
    ) : <EmptyState title="没有找到相关记录" description={timeFilter === 'all' ? '换一个关键词或标签试试看。' : '可以扩大时间范围再试试。'} />}
  </SafeAreaView>;
}

function SearchResultCard({ result, query }: { result: SearchResult; query: string }) {
  const { entry, sources } = result;
  const labels = sources.map((source) => source === 'content' ? '正文' : source === 'followUp' ? '后续' : '标签');
  return <Pressable onPress={() => router.push({ pathname: '/entry/[id]', params: { id: entry.id } })} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
    <View style={styles.cardHeader}><Text style={styles.date}>{formatShortDateTime(entry.occurredAt)}</Text><Text style={styles.matchSource}>命中{labels.join('、')}</Text></View>
    <Text numberOfLines={3} style={styles.content}><HighlightedText text={entry.content} query={sources.includes('content') ? query : ''} /></Text>
    {result.matchingFollowUp ? <View style={styles.matchRow}><Text style={styles.matchLabel}>后续</Text><Text numberOfLines={2} style={styles.matchText}><HighlightedText text={result.matchingFollowUp} query={query} /></Text></View> : null}
    {result.matchingTag ? <View style={styles.tag}><Text style={styles.tagText}>#<HighlightedText text={result.matchingTag} query={query} /></Text></View> : null}
  </Pressable>;
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(`(${escaped})`, 'gi');
  return <>{text.split(matcher).map((part, index) => part.toLocaleLowerCase() === query.toLocaleLowerCase() ? <Text key={`${part}-${index}`} style={styles.highlight}>{part}</Text> : part)}</>;
}

function dateRange(filter: TimeFilter) {
  if (filter === 'all') return undefined;
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const days = filter === 'today' ? 0 : filter === '7d' ? 6 : 29;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
  return { start: start.toISOString(), end: end.toISOString() };
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl }, back: { color: colors.primary, fontSize: 28 }, title: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, headerSpace: { width: 20 },
  searchBox: { height: 42, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.xl, paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted }, icon: { color: colors.textSecondary, fontSize: 22 }, input: { flex: 1, color: colors.text, fontSize: 13 }, clear: { color: colors.textSecondary, fontSize: 20 },
  filterScroll: { flexGrow: 0, height: 42 }, filters: { alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl }, filter: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted }, filterActive: { backgroundColor: colors.primary }, filterText: { color: colors.textSecondary, fontSize: 10 }, filterTextActive: { color: '#FFFFFF' },
  loader: { marginTop: 70 }, results: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl }, resultCount: { marginTop: spacing.sm, marginBottom: spacing.sm, color: colors.textSecondary, fontSize: 10 },
  card: { marginBottom: spacing.sm, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted }, pressed: { opacity: 0.66 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, date: { color: colors.primary, fontSize: 10, fontWeight: '700' }, matchSource: { color: colors.textFaint, fontSize: 9 },
  content: { marginTop: 6, color: colors.text, fontFamily: fonts.serif, fontSize: 14, lineHeight: 21 }, highlight: { color: colors.text, backgroundColor: colors.highlight, fontWeight: '700' },
  matchRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, matchLabel: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radii.pill, backgroundColor: colors.primarySoft, color: colors.primary, fontSize: 9 }, matchText: { flex: 1, color: colors.textSecondary, fontSize: 11, lineHeight: 17 },
  tag: { alignSelf: 'flex-start', marginTop: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: colors.primarySoft }, tagText: { color: colors.primary, fontSize: 10 },
});
