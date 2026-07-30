import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

const items: { title: string; description: string; route: Href }[] = [
  { title: '批量管理', description: '批量修改标签、地点、收藏或移入回收站', route: '/batch-manage' as Href },
  { title: '标签与地点', description: '新增、重命名、合并、删除和置顶', route: '/metadata' as Href },
  { title: '地点隐私与体检', description: '管理坐标隐私，并检查地点数据质量', route: '/location-health' as Href },
];

export default function ContentManagementScreen() {
  const { readingTheme } = useAppPreferences();
  return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}><Pressable hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable><Text style={[styles.title, { color: readingTheme.text }]}>内容管理</Text><View style={styles.space} /></View>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={[styles.hint, { color: readingTheme.secondary }]}>批量修改或清理历史坐标前，建议先导出一份完整 ZIP 备份。</Text>
      <View style={styles.items}>{items.map((item) => <Pressable key={item.title} onPress={() => router.push(item.route)} style={({ pressed }) => [styles.item, { backgroundColor: readingTheme.surface }, pressed && styles.pressed]}><View style={styles.copy}><Text style={[styles.itemTitle, { color: readingTheme.text }]}>{item.title}</Text><Text style={[styles.description, { color: readingTheme.secondary }]}>{item.description}</Text></View><Text style={styles.arrow}>›</Text></Pressable>)}</View>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, header: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth }, back: { color: colors.primary, fontSize: 13 }, title: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' }, space: { width: 42 },
  content: { padding: spacing.xl, paddingBottom: spacing.xxxl }, hint: { fontSize: 11, lineHeight: 18 }, items: { gap: spacing.sm, marginTop: spacing.lg }, item: { minHeight: 70, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, borderRadius: radii.lg }, copy: { flex: 1 }, itemTitle: { fontSize: 13, fontWeight: '700' }, description: { marginTop: 4, fontSize: 11, lineHeight: 17 }, arrow: { color: colors.primary, fontSize: 22 }, pressed: { opacity: 0.65 },
});
