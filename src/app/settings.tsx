import { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { getJournalStats } from '@/database/journal-repository';
import type { JournalStats } from '@/domain/journal';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { readingThemes, useAppPreferences, type FontSizeMode, type ReadingFontName, type ReadingThemeName } from '@/preferences/app-preferences';
import { deleteJournalImage, persistJournalImage } from '@/utils/image-storage';

const EMPTY_STATS: JournalStats = { entries: 0, followUps: 0, images: 0, deleted: 0 };

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const [stats, setStats] = useState(EMPTY_STATS);
  const { preferences, readingFontFamily, readingTheme, fontScale, updatePreferences } = useAppPreferences();
  const [nicknameEditor, setNicknameEditor] = useState(false);
  const [nickname, setNickname] = useState(preferences.nickname);

  useFocusEffect(useCallback(() => { void getJournalStats(db).then(setStats); }, [db]));

  async function chooseAvatar() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (result.canceled) return;
    try {
      const previous = preferences.avatarUri;
      const uri = await persistJournalImage(result.assets[0].uri, result.assets[0].fileName);
      await updatePreferences({ avatarUri: uri });
      if (previous) deleteJournalImage(previous);
    } catch { Alert.alert('头像保存失败', '请稍后再试。'); }
  }

  async function saveNickname() {
    const value = nickname.trim().slice(0, 20);
    if (!value) return;
    await updatePreferences({ nickname: value }); setNicknameEditor(false);
  }

  return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}>
      <Pressable hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable>
      <Text style={[styles.title, { color: readingTheme.text }]}>我的</Text>
      <View style={styles.headerSpace} />
    </View>
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.profile}><Pressable accessibilityLabel="修改头像" onPress={() => void chooseAvatar()}>{preferences.avatarUri ? <Image source={preferences.avatarUri} contentFit="cover" style={[styles.avatar, styles.avatarImage]} /> : <View style={styles.avatar}><Text style={styles.avatarText}>{preferences.nickname.slice(0, 1)}</Text></View>}</Pressable>
        <Pressable onPress={() => { setNickname(preferences.nickname); setNicknameEditor(true); }}><Text style={[styles.brand, { color: readingTheme.text }]}>{preferences.nickname}</Text><Text style={[styles.slogan, { color: readingTheme.secondary }]}>点击修改昵称 · 把日子慢慢收好。</Text></Pressable></View>

      <Text style={[styles.sectionTitle, { color: readingTheme.secondary }]}>我的日迹</Text>
      <View style={[styles.statsCard, { backgroundColor: readingTheme.surface }]}>
        <Stat value={stats.entries} label="记录" />
        <View style={[styles.statDivider, { backgroundColor: readingTheme.border }]} />
        <Stat value={stats.followUps} label="后续" />
        <View style={[styles.statDivider, { backgroundColor: readingTheme.border }]} />
        <Stat value={stats.images} label="图片" />
      </View>

      <Text style={[styles.sectionTitle, { color: readingTheme.secondary }]}>数据管理</Text>
      <Pressable onPress={() => router.push('/trash')} style={({ pressed }) => [styles.row, { backgroundColor: readingTheme.surface }, pressed && styles.pressed]}>
        <View><Text style={[styles.rowTitle, { color: readingTheme.text }]}>回收站</Text><Text style={[styles.rowDescription, { color: readingTheme.secondary }]}>删除的记录保留 30 天</Text></View>
        <View style={styles.rowRight}>{stats.deleted > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{stats.deleted}</Text></View> : null}<Text style={styles.arrow}>›</Text></View>
      </Pressable>

      <Pressable onPress={() => router.push('/backup')} style={({ pressed }) => [styles.row, styles.nextRow, { backgroundColor: readingTheme.surface }, pressed && styles.pressed]}>
        <View><Text style={[styles.rowTitle, { color: readingTheme.text }]}>备份与导出</Text><Text style={[styles.rowDescription, { color: readingTheme.secondary }]}>将日迹保存为通用 JSON 文件</Text></View>
        <Text style={styles.arrow}>›</Text>
      </Pressable>

      <Text style={[styles.sectionTitle, { color: readingTheme.secondary }]}>显示设置</Text>
      <SettingChoice title="背景主题" value={preferences.readingTheme} options={(Object.entries(readingThemes).map(([key, item]) => [key, item.label]) as [string, string][])} onChange={(value) => void updatePreferences({ readingTheme: value as ReadingThemeName })} />
      <SettingChoice title="正文字体" value={preferences.readingFont} options={[["serif", "宋体"], ["sans", "黑体"], ["light", "细黑"], ["system", "系统"]]} onChange={(value) => void updatePreferences({ readingFont: value as ReadingFontName })} />
      <SettingChoice title="字体大小" value={preferences.fontSize} options={[["verySmall", "很小"], ["small", "小"], ["standard", "标准"], ["large", "大"], ["veryLarge", "很大"]]} onChange={(value) => void updatePreferences({ fontSize: value as FontSizeMode })} />
      <View style={[styles.preview, { backgroundColor: readingTheme.surface }]}><Text style={[styles.previewTitle, { color: readingTheme.secondary }]}>实时预览</Text><Text style={[styles.previewText, { color: readingTheme.text, fontFamily: readingFontFamily, fontSize: 15 * fontScale, lineHeight: 24 * fontScale }]}>今天也值得被认真记录。</Text></View>

      <View style={[styles.coming, { borderColor: readingTheme.border }]}><Text style={[styles.comingTitle, { color: readingTheme.text }]}>阅读提示</Text><Text style={[styles.comingText, { color: readingTheme.secondary }]}>字体大小会在系统缩放基础上调整；日历数字保持固定比例，避免日期错位。</Text></View>
    </ScrollView>
    <Modal visible={nicknameEditor} transparent animationType="fade" onRequestClose={() => setNicknameEditor(false)}><Pressable onPress={() => setNicknameEditor(false)} style={styles.overlay}><Pressable onPress={(event) => event.stopPropagation()} style={[styles.editorCard, { backgroundColor: readingTheme.background }]}><Text style={[styles.editorTitle, { color: readingTheme.text }]}>修改昵称</Text><TextInput autoFocus maxLength={20} value={nickname} onChangeText={setNickname} placeholder="输入昵称" placeholderTextColor={readingTheme.secondary} style={[styles.nicknameInput, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} /><View style={styles.editorActions}><Pressable onPress={() => setNicknameEditor(false)}><Text style={[styles.cancelText, { color: readingTheme.secondary }]}>取消</Text></Pressable><Pressable onPress={() => void saveNickname()}><Text style={styles.confirmText}>保存</Text></Pressable></View></Pressable></Pressable></Modal>
  </SafeAreaView>;
}

function SettingChoice({ title, value, options, onChange }: { title: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  const { readingTheme } = useAppPreferences();
  return <View style={[styles.choiceRow, { backgroundColor: readingTheme.surface }]}><Text style={[styles.choiceTitle, { color: readingTheme.text }]}>{title}</Text><View style={styles.choices}>{options.map(([key, label]) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: value === key }} key={key} onPress={() => onChange(key)} style={[styles.choice, value === key && styles.choiceActive]}><Text style={[styles.choiceText, { color: readingTheme.secondary }, value === key && styles.choiceTextActive]}>{label}</Text></Pressable>)}</View></View>;
}

function Stat({ value, label }: { value: number; label: string }) {
  const { readingTheme } = useAppPreferences();
  return <View style={styles.stat}><Text style={[styles.statValue, { color: readingTheme.text }]}>{value}</Text><Text style={[styles.statLabel, { color: readingTheme.secondary }]}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  back: { color: colors.primary, fontSize: 13 }, title: { color: colors.text, fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, headerSpace: { width: 42 },
  scroll: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.xxxl },
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  avatar: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: colors.primary },
  avatarImage: { backgroundColor: 'transparent' },
  avatarText: { color: '#FFFFFF', fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' },
  brand: { color: colors.text, fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' }, slogan: { marginTop: 1, color: colors.textSecondary, fontSize: 10 },
  sectionTitle: { marginTop: spacing.lg, marginBottom: 6, color: colors.textFaint, fontSize: 10, letterSpacing: 1 },
  statsCard: { height: 64, flexDirection: 'row', alignItems: 'center', borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  stat: { flex: 1, alignItems: 'center', justifyContent: 'center' }, statValue: { color: colors.text, fontFamily: fonts.serif, fontSize: 16, lineHeight: 21, fontWeight: '600', includeFontPadding: false }, statLabel: { marginTop: 1, color: colors.textSecondary, fontSize: 9 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 24, backgroundColor: colors.border },
  row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  nextRow: { marginTop: spacing.sm },
  pressed: { opacity: 0.62 }, rowTitle: { color: colors.text, fontSize: 13, fontWeight: '600' }, rowDescription: { marginTop: 1, color: colors.textFaint, fontSize: 9 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, badge: { minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, borderRadius: 11, backgroundColor: colors.primarySoft }, badgeText: { color: colors.primary, fontSize: 10, fontWeight: '700' }, arrow: { color: colors.textFaint, fontSize: 22 },
  coming: { marginTop: spacing.lg, padding: spacing.md, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  comingTitle: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' }, comingText: { marginTop: spacing.xs, color: colors.textFaint, fontSize: 10, lineHeight: 17 },
  choiceRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted }, choiceTitle: { color: colors.text, fontSize: 12, fontWeight: '600' }, choices: { flexDirection: 'row', gap: spacing.xs }, choice: { minHeight: 32, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.pill }, choiceActive: { backgroundColor: colors.primary }, choiceText: { color: colors.textSecondary, fontSize: 9 }, choiceTextActive: { color: '#FFFFFF', fontWeight: '700' },
  preview: { marginBottom: spacing.sm, padding: spacing.lg, borderRadius: radii.md }, previewTitle: { fontSize: 9 }, previewText: { marginTop: spacing.sm },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.overlay }, editorCard: { width: '100%', maxWidth: 300, padding: spacing.xl, borderRadius: radii.lg, backgroundColor: colors.background }, editorTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 17, fontWeight: '600', textAlign: 'center' }, nicknameInput: { height: 44, marginTop: spacing.lg, paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted, color: colors.text, fontSize: 14 }, editorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xxl, marginTop: spacing.xl }, cancelText: { color: colors.textSecondary, fontSize: 12 }, confirmText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
});
