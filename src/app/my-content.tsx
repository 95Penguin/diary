import { router, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

const destinations: { title: string; description: string; route: Href }[] = [
  { title: '草稿箱', description: '继续编辑尚未保存的内容', route: '/drafts' as Href },
  { title: '收藏', description: '查看标记过的重要时刻', route: '/favorites' as Href },
  { title: '媒体浏览', description: '按年月查看记录中的图片和视频', route: '/media-library' as Href },
  { title: '内容管理', description: '批量管理、标签与地点', route: '/content-management' as Href },
];

export default function MyContentScreen() {
  const { readingTheme } = useAppPreferences();

  return <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="返回" hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable>
      <Text style={[styles.title, { color: readingTheme.text }]}>我的内容</Text>
      <View style={styles.headerSpace} />
    </View>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {destinations.map((item, index) => <Pressable
        accessibilityRole="button"
        key={item.title}
        onPress={() => router.push(item.route)}
        style={({ pressed }) => [styles.row, index > 0 && styles.nextRow, { backgroundColor: readingTheme.surface }, pressed && styles.pressed]}
      >
        <View style={styles.rowCopy}>
          <Text style={[styles.rowTitle, { color: readingTheme.text }]}>{item.title}</Text>
          <Text style={[styles.rowDescription, { color: readingTheme.secondary }]}>{item.description}</Text>
        </View>
        <Text style={[styles.arrow, { color: readingTheme.secondary }]}>›</Text>
      </Pressable>)}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { color: colors.primary, fontSize: 13 },
  title: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' },
  headerSpace: { width: 42 },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xxxl },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radii.md },
  nextRow: { marginTop: spacing.sm },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 13, fontWeight: '600' },
  rowDescription: { marginTop: 2, fontSize: 11 },
  arrow: { fontSize: 22 },
  pressed: { opacity: 0.62 },
});
