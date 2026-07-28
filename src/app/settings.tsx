import { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as LocalAuthentication from 'expo-local-authentication';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { getJournalStats, getLastExportAt } from '@/database/journal-repository';
import type { JournalStats } from '@/domain/journal';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { readingThemes, useAppPreferences, type AppLockDelaySeconds, type BackupReminderDays, type FontSizeMode, type ReadingFontName, type ReadingThemeName } from '@/preferences/app-preferences';
import { setBackupReminder } from '@/utils/backup-reminder';
import { deleteJournalImage, persistJournalImage } from '@/utils/image-storage';

const EMPTY_STATS: JournalStats = { entries: 0, followUps: 0, images: 0, deleted: 0 };

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const [stats, setStats] = useState(EMPTY_STATS);
  const { preferences, readingFontFamily, readingTheme, fontScale, updatePreferences } = useAppPreferences();
  const [profileEditor, setProfileEditor] = useState<'nickname' | 'signature' | null>(null);
  const [nickname, setNickname] = useState(preferences.nickname);
  const [signature, setSignature] = useState(preferences.signature);

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

  async function saveProfile() {
    const value = nickname.trim().slice(0, 20);
    if (!value) return;
    if (profileEditor === 'nickname') await updatePreferences({ nickname: value });
    else await updatePreferences({ signature: signature.trim().slice(0, 50) });
    setProfileEditor(null);
  }

  async function toggleAppLock() {
    if (preferences.appLockEnabled) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: '关闭应用锁',
        fallbackLabel: '使用锁屏密码',
        disableDeviceFallback: false,
      });
      if (result.success) await updatePreferences({ appLockEnabled: false });
      return;
    }
    const [hardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    if (!hardware || !enrolled) {
      Alert.alert('暂时无法开启', '请先在手机设置中录入指纹或人脸，并设置锁屏密码。');
      return;
    }
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: '开启拾时应用锁',
      fallbackLabel: '使用锁屏密码',
      disableDeviceFallback: false,
    });
    if (result.success) await updatePreferences({ appLockEnabled: true });
  }

  async function changeBackupReminder(value: string) {
    const days = Number(value) as BackupReminderDays;
    const lastExportAt = await getLastExportAt(db);
    const enabled = await setBackupReminder(days, lastExportAt);
    if (!enabled) {
      Alert.alert('没有通知权限', '请在手机设置中允许拾时发送通知，才能定期提醒备份。');
      return;
    }
    await updatePreferences({ backupReminderDays: days });
  }

  return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}>
      <Pressable hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable>
      <Text style={[styles.title, { color: readingTheme.text }]}>我的</Text>
      <View style={styles.headerSpace} />
    </View>
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.profile}><Pressable accessibilityLabel="修改头像" onPress={() => void chooseAvatar()}>{preferences.avatarUri ? <Image source={preferences.avatarUri} contentFit="cover" style={[styles.avatar, styles.avatarImage]} /> : <View style={styles.avatar}><Text style={styles.avatarText}>{preferences.nickname.slice(0, 1)}</Text></View>}</Pressable>
        <View style={styles.profileInfo}>
          <Pressable accessibilityLabel="编辑昵称" style={styles.profileField} onPress={() => { setNickname(preferences.nickname); setProfileEditor('nickname'); }}><Text numberOfLines={1} style={[styles.brand, { color: readingTheme.text }]}>{preferences.nickname}</Text></Pressable>
          <Pressable accessibilityLabel="编辑个性签名" style={styles.profileField} onPress={() => { setSignature(preferences.signature); setProfileEditor('signature'); }}><Text numberOfLines={1} style={[styles.slogan, { color: readingTheme.secondary }]}>{preferences.signature || '把日子慢慢收好。'}</Text></Pressable>
        </View>
      </View>

      <Text style={[styles.sectionTitle, { color: readingTheme.secondary }]}>使用概览</Text>
      <View style={[styles.statsCard, { backgroundColor: readingTheme.surface }]}>
        <Stat value={stats.entries} label="记录" />
        <View style={[styles.statDivider, { backgroundColor: readingTheme.border }]} />
        <Stat value={stats.followUps} label="后续" />
        <View style={[styles.statDivider, { backgroundColor: readingTheme.border }]} />
        <Stat value={stats.images} label="图片" />
      </View>

      <Text style={[styles.sectionTitle, { color: readingTheme.secondary }]}>内容管理</Text>
      <Pressable onPress={() => router.push('/metadata' as Href)} style={({ pressed }) => [styles.row, { backgroundColor: readingTheme.surface }, pressed && styles.pressed]}>
        <View><Text style={[styles.rowTitle, { color: readingTheme.text }]}>标签与地点</Text><Text style={[styles.rowDescription, { color: readingTheme.secondary }]}>整理、合并或移除历史内容</Text></View>
        <Text style={styles.arrow}>›</Text>
      </Pressable>

      <Text style={[styles.sectionTitle, { color: readingTheme.secondary }]}>数据与备份</Text>
      <Pressable onPress={() => router.push('/trash')} style={({ pressed }) => [styles.row, { backgroundColor: readingTheme.surface }, pressed && styles.pressed]}>
        <View><Text style={[styles.rowTitle, { color: readingTheme.text }]}>回收站</Text><Text style={[styles.rowDescription, { color: readingTheme.secondary }]}>删除的记录保留 30 天</Text></View>
        <View style={styles.rowRight}>{stats.deleted > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{stats.deleted}</Text></View> : null}<Text style={styles.arrow}>›</Text></View>
      </Pressable>

      <Pressable onPress={() => router.push('/backup')} style={({ pressed }) => [styles.row, styles.nextRow, { backgroundColor: readingTheme.surface }, pressed && styles.pressed]}>
        <View><Text style={[styles.rowTitle, { color: readingTheme.text }]}>备份与导出</Text><Text style={[styles.rowDescription, { color: readingTheme.secondary }]}>导出 ZIP，并检查备份是否完整可恢复</Text></View>
        <Text style={styles.arrow}>›</Text>
      </Pressable>
      <View style={styles.reminderGap} />
      <SettingChoice
        title="备份提醒"
        value={String(preferences.backupReminderDays)}
        options={[['0', '关闭'], ['7', '7天'], ['14', '14天'], ['30', '30天']]}
        onChange={(value) => void changeBackupReminder(value)}
      />

      <Text style={[styles.sectionTitle, { color: readingTheme.secondary }]}>隐私与安全</Text>
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: preferences.appLockEnabled }}
        onPress={() => void toggleAppLock()}
        style={({ pressed }) => [styles.row, { backgroundColor: readingTheme.surface }, pressed && styles.pressed]}
      >
        <View><Text style={[styles.rowTitle, { color: readingTheme.text }]}>应用锁</Text><Text style={[styles.rowDescription, { color: readingTheme.secondary }]}>离开应用后使用手机凭据重新解锁</Text></View>
        <View style={[styles.switchTrack, preferences.appLockEnabled && styles.switchTrackActive]}>
          <View style={[styles.switchThumb, preferences.appLockEnabled && styles.switchThumbActive]} />
        </View>
      </Pressable>
      {preferences.appLockEnabled ? <>
        <View style={styles.reminderGap} />
        <SettingChoice
          title="再次锁定"
          value={String(preferences.appLockDelaySeconds)}
          options={[['0', '立即'], ['60', '1分钟'], ['300', '5分钟']]}
          onChange={(value) => void updatePreferences({ appLockDelaySeconds: Number(value) as AppLockDelaySeconds })}
        />
      </> : null}
      <Text style={[styles.sectionTitle, { color: readingTheme.secondary }]}>外观与阅读</Text>
      <ThemeChoice value={preferences.readingTheme} onChange={(value) => void updatePreferences({ readingTheme: value })} />
      <SettingChoice title="正文字体" value={preferences.readingFont} options={[["serif", "宋体"], ["sans", "黑体"], ["light", "细黑"], ["mono", "等宽"], ["system", "系统"]]} onChange={(value) => void updatePreferences({ readingFont: value as ReadingFontName })} />
      <SettingChoice title="字体大小" value={preferences.fontSize} options={[["verySmall", "很小"], ["small", "小"], ["standard", "标准"], ["large", "大"], ["veryLarge", "很大"]]} onChange={(value) => void updatePreferences({ fontSize: value as FontSizeMode })} />
      <View style={[styles.preview, { backgroundColor: readingTheme.surface }]}><Text style={[styles.previewTitle, { color: readingTheme.secondary }]}>实时预览</Text><Text style={[styles.previewText, { color: readingTheme.text, fontFamily: readingFontFamily, fontSize: 15 * fontScale, lineHeight: 24 * fontScale }]}>今天也值得被认真记录。</Text></View>

      <View style={[styles.coming, { borderColor: readingTheme.border }]}><Text style={[styles.comingTitle, { color: readingTheme.text }]}>阅读提示</Text><Text style={[styles.comingText, { color: readingTheme.secondary }]}>字体大小会在系统缩放基础上调整；日历数字保持固定比例，避免日期错位。</Text></View>

      <Text style={[styles.sectionTitle, { color: readingTheme.secondary }]}>关于</Text>
      <Pressable onPress={() => router.push('/about' as Href)} style={({ pressed }) => [styles.row, { backgroundColor: readingTheme.surface }, pressed && styles.pressed]}>
        <View><Text style={[styles.rowTitle, { color: readingTheme.text }]}>关于拾时</Text><Text style={[styles.rowDescription, { color: readingTheme.secondary }]}>版本、数据库状态与故障诊断</Text></View>
        <Text style={styles.arrow}>›</Text>
      </Pressable>
    </ScrollView>
    <Modal visible={profileEditor !== null} transparent animationType="fade" onRequestClose={() => setProfileEditor(null)}><Pressable onPress={() => setProfileEditor(null)} style={styles.overlay}><Pressable onPress={(event) => event.stopPropagation()} style={[styles.editorCard, { backgroundColor: readingTheme.background }]}><Text style={[styles.editorTitle, { color: readingTheme.text }]}>{profileEditor === 'nickname' ? '编辑昵称' : '编辑个性签名'}</Text>{profileEditor === 'nickname' ? <TextInput autoFocus maxLength={20} value={nickname} onChangeText={setNickname} placeholder="输入昵称" placeholderTextColor={readingTheme.secondary} style={[styles.nicknameInput, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} /> : <TextInput autoFocus multiline textAlignVertical="top" maxLength={50} value={signature} onChangeText={setSignature} placeholder="写一句属于你的话" placeholderTextColor={readingTheme.secondary} style={[styles.nicknameInput, styles.signatureInput, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} />}<View style={styles.editorActions}><Pressable onPress={() => setProfileEditor(null)}><Text style={[styles.cancelText, { color: readingTheme.secondary }]}>取消</Text></Pressable><Pressable onPress={() => void saveProfile()}><Text style={styles.confirmText}>保存</Text></Pressable></View></Pressable></Pressable></Modal>
  </SafeAreaView>;
}

function SettingChoice({ title, value, options, onChange }: { title: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  const { readingTheme } = useAppPreferences();
  return <View style={[styles.choiceRow, { backgroundColor: readingTheme.surface }]}><Text style={[styles.choiceTitle, { color: readingTheme.text }]}>{title}</Text><View style={styles.choices}>{options.map(([key, label]) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: value === key }} key={key} onPress={() => onChange(key)} style={[styles.choice, label.length === 1 && styles.singleCharacterChoice, value === key && styles.choiceActive]}><Text style={[styles.choiceText, { color: readingTheme.secondary }, value === key && styles.choiceTextActive]}>{label}</Text></Pressable>)}</View></View>;
}

function ThemeChoice({ value, onChange }: { value: ReadingThemeName; onChange: (value: ReadingThemeName) => void }) {
  const { readingTheme } = useAppPreferences();
  return <View style={[styles.themeRow, { backgroundColor: readingTheme.surface }]}>
    <Text style={[styles.choiceTitle, { color: readingTheme.text }]}>背景主题</Text>
    <ScrollView horizontal contentContainerStyle={styles.themeChoices} showsHorizontalScrollIndicator={false}>
      {(Object.entries(readingThemes) as [ReadingThemeName, (typeof readingThemes)[ReadingThemeName]][]).map(([key, theme]) => {
        const selected = value === key;
        return <Pressable accessibilityLabel={`${theme.label}主题`} accessibilityRole="radio" accessibilityState={{ checked: selected }} key={key} onPress={() => onChange(key)} style={styles.themeChoice}>
          <View style={[styles.themeSwatch, { backgroundColor: theme.background, borderColor: selected ? colors.primary : theme.border }, selected && styles.themeSwatchActive]}>
            <View style={[styles.themeSwatchInner, { backgroundColor: theme.surface }]} />
          </View>
          <Text style={[styles.themeLabel, { color: selected ? colors.primary : readingTheme.secondary }, selected && styles.themeLabelActive]}>{theme.label}</Text>
        </Pressable>;
      })}
    </ScrollView>
  </View>;
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
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  profileInfo: { flex: 1, minWidth: 0, gap: 4 },
  profileField: { minHeight: 24, justifyContent: 'center' },
  avatar: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: colors.primary },
  avatarImage: { backgroundColor: 'transparent' },
  avatarText: { color: '#FFFFFF', fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' },
  brand: { flex: 1, color: colors.text, fontFamily: fonts.serif, fontSize: 16, lineHeight: 21, fontWeight: '600' }, slogan: { flex: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 16 },
  sectionTitle: { marginTop: spacing.lg, marginBottom: 6, color: colors.textFaint, fontSize: 10, letterSpacing: 1 },
  statsCard: { height: 64, flexDirection: 'row', alignItems: 'center', borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  stat: { flex: 1, alignItems: 'center', justifyContent: 'center' }, statValue: { color: colors.text, fontFamily: fonts.serif, fontSize: 16, lineHeight: 21, fontWeight: '600', includeFontPadding: false }, statLabel: { marginTop: 1, color: colors.textSecondary, fontSize: 9 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 24, backgroundColor: colors.border },
  row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  nextRow: { marginTop: spacing.sm },
  pressed: { opacity: 0.62 }, rowTitle: { color: colors.text, fontSize: 13, fontWeight: '600' }, rowDescription: { marginTop: 1, color: colors.textFaint, fontSize: 9 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, badge: { minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, borderRadius: 11, backgroundColor: colors.primarySoft }, badgeText: { color: colors.primary, fontSize: 10, fontWeight: '700' }, arrow: { color: colors.textFaint, fontSize: 22 },
  switchTrack: { width: 42, height: 24, justifyContent: 'center', paddingHorizontal: 3, borderRadius: 12, backgroundColor: colors.border },
  switchTrackActive: { backgroundColor: colors.primary },
  switchThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#FFFFFF' },
  switchThumbActive: { alignSelf: 'flex-end' },
  reminderGap: { height: spacing.sm },
  coming: { marginTop: spacing.lg, padding: spacing.md, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  comingTitle: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' }, comingText: { marginTop: spacing.xs, color: colors.textFaint, fontSize: 10, lineHeight: 17 },
  choiceRow: { minHeight: 54, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted }, choiceTitle: { color: colors.text, fontSize: 12, lineHeight: 32, fontWeight: '600' }, choices: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.xs }, choice: { height: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: 16 }, singleCharacterChoice: { width: 32, paddingHorizontal: 0 }, choiceActive: { backgroundColor: colors.primary }, choiceText: { color: colors.textSecondary, fontSize: 9 }, choiceTextActive: { color: '#FFFFFF', fontWeight: '700' },
  themeRow: { minHeight: 82, marginBottom: spacing.sm, paddingLeft: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted }, themeChoices: { alignItems: 'center', gap: spacing.md, paddingLeft: spacing.sm, paddingRight: spacing.md, paddingBottom: spacing.sm }, themeChoice: { width: 42, alignItems: 'center' }, themeSwatch: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 15 }, themeSwatchActive: { borderWidth: 2 }, themeSwatchInner: { width: 12, height: 12, borderRadius: 6 }, themeLabel: { marginTop: 3, fontSize: 8 }, themeLabelActive: { fontWeight: '700' },
  preview: { marginBottom: spacing.sm, padding: spacing.lg, borderRadius: radii.md }, previewTitle: { fontSize: 9 }, previewText: { marginTop: spacing.sm },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.overlay }, editorCard: { width: '100%', maxWidth: 300, padding: spacing.xl, borderRadius: radii.lg, backgroundColor: colors.background }, editorTitle: { marginBottom: spacing.md, color: colors.text, fontFamily: fonts.serif, fontSize: 17, fontWeight: '600', textAlign: 'center' }, nicknameInput: { height: 44, paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted, color: colors.text, fontSize: 14 }, signatureInput: { height: 76, paddingTop: spacing.sm }, editorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xxl, marginTop: spacing.xl }, cancelText: { color: colors.textSecondary, fontSize: 12 }, confirmText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
});
