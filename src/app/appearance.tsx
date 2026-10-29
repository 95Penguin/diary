import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { readingThemes, useAppPreferences, type FontSizeMode, type ImageSaveQuality, type ReadingComfortName, type ReadingFontName, type ReadingThemeName } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

export default function AppearanceScreen() {
  const { preferences, readingBodyStyle, readingFontFamily, readingTheme, fontScale, updatePreferences } = useAppPreferences();

  return <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="返回" hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable>
      <Text style={[styles.title, { color: readingTheme.text }]}>外观与阅读</Text>
      <View style={styles.headerSpace} />
    </View>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <SettingChoice title="图片保存质量" value={preferences.imageSaveQuality} options={[["original", "原图"], ["high", "高清"], ["compact", "节省空间"]]} onChange={(value) => void updatePreferences({ imageSaveQuality: value as ImageSaveQuality })} />
      <Text style={[styles.qualityHint, { color: readingTheme.secondary }]}>原图使用系统提供的最高质量；高清最长边 4096px；节省空间最长边 2048px。选择媒体后会显示预计占用。</Text>
      <ThemeChoice value={preferences.readingTheme} onChange={(value) => void updatePreferences({ readingTheme: value })} />
      <SettingChoice title="正文字体" value={preferences.readingFont} options={[["serif", "宋体"], ["sans", "黑体"], ["light", "细黑"], ["mono", "等宽"], ["system", "系统"]]} onChange={(value) => void updatePreferences({ readingFont: value as ReadingFontName })} />
      <SettingChoice title="字体大小" value={preferences.fontSize} options={[["verySmall", "很小"], ["small", "小"], ["standard", "标准"], ["large", "大"], ["veryLarge", "很大"]]} onChange={(value) => void updatePreferences({ fontSize: value as FontSizeMode })} />
      <SettingChoice title="阅读舒适度" value={preferences.readingComfort} options={[["compact", "紧凑"], ["comfortable", "舒适"], ["spacious", "宽松"]]} onChange={(value) => void updatePreferences({ readingComfort: value as ReadingComfortName })} />
      <View style={[styles.preview, { backgroundColor: readingTheme.surface }]}>
        <Text style={[styles.previewTitle, { color: readingTheme.secondary }]}>实时预览</Text>
        <Text style={[styles.previewText, { color: readingBodyStyle.color, fontFamily: readingFontFamily, fontSize: 15 * fontScale, lineHeight: 24 * fontScale * readingBodyStyle.lineHeightMultiplier, letterSpacing: readingBodyStyle.letterSpacing }]}>今天也值得被认真记录。</Text>
      </View>
    </ScrollView>
  </SafeAreaView>;
}

function SettingChoice({ title, value, options, onChange }: { title: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  const { readingTheme } = useAppPreferences();
  return <View style={[styles.choiceRow, { backgroundColor: readingTheme.surface }]}>
    <Text style={[styles.choiceTitle, { color: readingTheme.text }]}>{title}</Text>
    <View style={styles.choices}>{options.map(([key, label]) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: value === key }} key={key} onPress={() => onChange(key)} style={[styles.choice, label.length === 1 && styles.singleCharacterChoice, value === key && styles.choiceActive]}><Text style={[styles.choiceText, { color: readingTheme.secondary }, value === key && styles.choiceTextActive]}>{label}</Text></Pressable>)}</View>
  </View>;
}

function ThemeChoice({ value, onChange }: { value: ReadingThemeName; onChange: (value: ReadingThemeName) => void }) {
  const { readingTheme } = useAppPreferences();
  return <View style={[styles.themeRow, { backgroundColor: readingTheme.surface }]}>
    <Text style={[styles.choiceTitle, { color: readingTheme.text }]}>背景主题</Text>
    <ScrollView horizontal contentContainerStyle={styles.themeChoices} showsHorizontalScrollIndicator={false}>
      {(Object.entries(readingThemes) as [ReadingThemeName, (typeof readingThemes)[ReadingThemeName]][]).map(([key, theme]) => {
        const selected = value === key;
        return <Pressable accessibilityLabel={`${theme.label}主题`} accessibilityRole="radio" accessibilityState={{ checked: selected }} key={key} onPress={() => onChange(key)} style={styles.themeChoice}>
          <View style={[styles.themeSwatch, { backgroundColor: theme.background, borderColor: selected ? colors.primary : theme.border }, selected && styles.themeSwatchActive]}><View style={[styles.themeSwatchInner, { backgroundColor: theme.surface }]} /></View>
          <Text style={[styles.themeLabel, { color: selected ? colors.primary : readingTheme.secondary }, selected && styles.themeLabelActive]}>{theme.label}</Text>
        </Pressable>;
      })}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { color: colors.primary, fontSize: 13 },
  title: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' },
  headerSpace: { width: 42 },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xxxl },
  qualityHint: { marginTop: spacing.sm, marginBottom: spacing.md, paddingHorizontal: spacing.sm, fontSize: 10, lineHeight: 16 },
  choiceRow: { minHeight: 48, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.md },
  choiceTitle: { fontSize: 12, lineHeight: 30, fontWeight: '600' },
  choices: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.xs },
  choice: { minHeight: 30, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: 15 },
  singleCharacterChoice: { width: 30, paddingHorizontal: 0 },
  choiceActive: { backgroundColor: colors.primary },
  choiceText: { fontSize: 10 },
  choiceTextActive: { color: '#FFFFFF', fontWeight: '700' },
  themeRow: { minHeight: 88, marginBottom: spacing.sm, paddingLeft: spacing.md, borderRadius: radii.md },
  themeChoices: { alignItems: 'center', gap: spacing.md, paddingLeft: spacing.sm, paddingRight: spacing.md, paddingBottom: spacing.sm },
  themeChoice: { minWidth: 44, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  themeSwatch: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 16 },
  themeSwatchActive: { borderWidth: 2 },
  themeSwatchInner: { width: 12, height: 12, borderRadius: 6 },
  themeLabel: { marginTop: 3, fontSize: 11 },
  themeLabelActive: { fontWeight: '700' },
  preview: { marginBottom: spacing.sm, padding: spacing.lg, borderRadius: radii.md },
  previewTitle: { fontSize: 11 },
  previewText: { marginTop: spacing.sm },
});
