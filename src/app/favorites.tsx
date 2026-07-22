import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';

import { EmptyState } from '@/components/empty-state';
import { EntryCard } from '@/components/entry-card';
import { listFavoriteEntries } from '@/database/journal-repository';
import type { Entry } from '@/domain/journal';
import { colors, fonts, spacing } from '@/theme/tokens';
import { useAppPreferences } from '@/preferences/app-preferences';

export default function FavoritesScreen() {
  const db = useSQLiteContext();
  const { readingTheme } = useAppPreferences();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  useFocusEffect(useCallback(() => {
    let active = true;
    void listFavoriteEntries(db).then((items) => { if (active) { setEntries(items); setLoading(false); } });
    return () => { active = false; };
  }, [db]));

  return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]} edges={['top', 'bottom']}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}><Pressable accessibilityLabel="返回" hitSlop={12} onPress={() => router.canGoBack() ? router.back() : router.replace('/')}><Text style={styles.back}>‹ 返回</Text></Pressable><Text style={[styles.title, { color: readingTheme.text }]}>我的收藏</Text><View style={styles.space} /></View>
    {loading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : entries.length ? <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
      <Text style={[styles.count, { color: readingTheme.secondary }]}>{entries.length} 条珍藏的时刻</Text>
      {entries.map((entry) => <EntryCard key={entry.id} entry={entry} onPress={() => router.push({ pathname: '/entry/[id]', params: { id: entry.id } })} />)}
    </ScrollView> : <EmptyState title="还没有收藏" description="在记录详情中点亮爱心，重要的时刻会留在这里。" />}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  back: { color: colors.primary, fontSize: 13 }, title: { color: colors.text, fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, space: { width: 42 }, loader: { marginTop: 80 }, list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl }, count: { paddingVertical: spacing.md, color: colors.textSecondary, fontSize: 10 },
});
