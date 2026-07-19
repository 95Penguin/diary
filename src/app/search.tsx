import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { EmptyState } from '@/components/empty-state';
import { EntryCard } from '@/components/entry-card';
import { listEntries } from '@/database/journal-repository';
import type { Entry } from '@/domain/journal';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

export default function SearchScreen() {
  const db = useSQLiteContext();
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (value: string) => {
    if (!value.trim()) { setEntries([]); setLoading(false); return; }
    setLoading(true);
    try { setEntries(await listEntries(db, value)); } finally { setLoading(false); }
  }, [db]);

  useEffect(() => { const timer = setTimeout(() => void search(query), 250); return () => clearTimeout(timer); }, [query, search]);

  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.header}><Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.back}>‹</Text></Pressable><Text style={styles.title}>搜索</Text><View style={styles.headerSpace} /></View>
    <View style={styles.searchBox}><Text style={styles.icon}>⌕</Text><TextInput autoFocus value={query} onChangeText={setQuery} placeholder="搜索记录与后续" placeholderTextColor={colors.textFaint} returnKeyType="search" style={styles.input} />{query ? <Pressable onPress={() => setQuery('')}><Text style={styles.clear}>×</Text></Pressable> : null}</View>
    {loading ? <ActivityIndicator style={styles.loader} color={colors.primary} /> : !query.trim() ? <EmptyState title="找回一段记忆" description="输入正文或后续中出现过的词。" /> : entries.length ? (
      <ScrollView contentContainerStyle={styles.results} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.resultCount}>找到 {entries.length} 条相关记录</Text>
        {entries.map((entry) => <EntryCard key={entry.id} entry={entry} onPress={() => router.push({ pathname: '/entry/[id]', params: { id: entry.id } })} />)}
      </ScrollView>
    ) : <EmptyState title="没有找到相关记录" description="换一个关键词试试看。" />}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl }, back: { color: colors.primary, fontSize: 28 }, title: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, headerSpace: { width: 20 },
  searchBox: { height: 46, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.xl, paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted }, icon: { color: colors.textSecondary, fontSize: 22 }, input: { flex: 1, color: colors.text, fontSize: 14 }, clear: { color: colors.textSecondary, fontSize: 20 },
  loader: { marginTop: 70 }, results: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl }, resultCount: { marginTop: spacing.xl, marginBottom: spacing.md, color: colors.textSecondary, fontSize: 11 },
});
