import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, type Href } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';

import { showAppDialog } from '@/components/app-dialog-host';
import { addTimeCapsuleImages, createTimeCapsule, setTimeCapsuleNotification } from '@/database/time-capsule-repository';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { formatFullDate, parseLocalDateTime, toLocalDateTimeInput } from '@/utils/date';
import { scheduleTimeCapsuleNotification } from '@/utils/time-capsule-notifications';
import { MediaThumbnail } from '@/components/media-view';
import { getPickerMediaType, preparePickedMedia } from '@/utils/picker-media';
import { persistJournalImage, deleteJournalImage } from '@/utils/image-storage';
import { createPersistentVideoThumbnail } from '@/utils/video-thumbnail-cache';
import type { JournalMediaType } from '@/domain/journal';

type PendingMedia = { uri: string; width: number; height: number; mediaType: JournalMediaType; pairedVideoUri: string | null; duration: number | null; thumbnailUri: string | null; fileName?: string | null };

export default function TimeCapsuleComposeScreen() {
  const db = useSQLiteContext();
  const { readingTheme, readingFontFamily, readingBodyStyle, fontScale } = useAppPreferences();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [openValue, setOpenValue] = useState(() => { const date = new Date(); date.setFullYear(date.getFullYear() + 1); return toLocalDateTimeInput(date.toISOString()); });
  const [saving, setSaving] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [images, setImages] = useState<PendingMedia[]>([]);
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | 'datetime' | null>(null);
  const [pickerMinimum] = useState(() => new Date(Date.now() + 60_000));

  async function pickMedia() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: 5 - images.length, quality: 0.9 });
      if (result.canceled) return;
      const prepared = await preparePickedMedia(result.assets);
      if (prepared) setImages((current) => [...current, ...prepared.slice(0, 5 - current.length).map((item) => ({ uri: item.uri, width: item.width, height: item.height, mediaType: getPickerMediaType(item), pairedVideoUri: null, duration: item.duration ?? null, thumbnailUri: null, fileName: item.fileName }))]);
    } catch { await showAppDialog({ title: '无法添加媒体', message: '相册暂时无法打开，请检查照片权限后重试。' }); }
  }

  function chooseOffset(months: number) { const date = new Date(); date.setMonth(date.getMonth() + months); setOpenValue(toLocalDateTimeInput(date.toISOString())); }
  function openDatePicker() { setPickerMode(Platform.OS === 'ios' ? 'datetime' : 'date'); }
  function changeDate(event: DateTimePickerEvent, selected?: Date) {
    if (event.type === 'dismissed' || !selected) { setPickerMode(null); return; }
    setOpenValue(toLocalDateTimeInput(selected.toISOString()));
    if (Platform.OS === 'android' && pickerMode === 'date') setPickerMode('time');
    else setPickerMode(null);
  }
  async function cancelCompose() {
    if (!title.trim() && !content.trim() && !images.length) { router.back(); return; }
    const decision = await showAppDialog({ title: '退出编辑？', message: '尚未封存的文字和媒体会丢失。', actions: [{ label: '继续编辑', value: 'stay' }, { label: '退出', value: 'leave', tone: 'danger' }] });
    if (decision === 'leave') router.back();
  }
  async function save() {
    if (saving) return;
    const openAt = parseLocalDateTime(openValue);
    if (!title.trim() || !content.trim()) { await showAppDialog({ title: '还没有写完整', message: '请填写胶囊标题和想留给未来的话。' }); return; }
    if (!openAt || new Date(openAt).getTime() <= Date.now()) { await showAppDialog({ title: '开启时间不正确', message: '请输入未来的日期和时间，格式为 YYYY-MM-DD HH:mm。' }); return; }
    const decision = await showAppDialog({ title: '确定封存这枚胶囊？', message: `${formatFullDate(openAt)}开启${images.length ? ` · ${images.length} 个媒体` : ''}\n封存后，正文、媒体和开启时间都不能修改。`, actions: [{ label: '再检查一下', value: 'cancel' }, { label: '确定封存', value: 'save', tone: 'primary' }] });
    if (decision !== 'save') return;
    setSaving(true);
    try {
      const id = await createTimeCapsule(db, { title, content, openAt, notificationEnabled: reminderEnabled });
      const persisted: string[] = [];
      try {
        const saved = [];
        for (const image of images) {
          const uri = await persistJournalImage(image.uri, image.fileName); persisted.push(uri);
          const pairedVideoUri = image.pairedVideoUri ? await persistJournalImage(image.pairedVideoUri) : null;
          if (pairedVideoUri) persisted.push(pairedVideoUri);
          const thumbnailUri = image.mediaType === 'video' ? await createPersistentVideoThumbnail(uri) : null;
          if (thumbnailUri) persisted.push(thumbnailUri);
          saved.push({ ...image, uri, pairedVideoUri, thumbnailUri });
        }
        await addTimeCapsuleImages(db, id, saved);
      } catch (error) { persisted.forEach(deleteJournalImage); await db.runAsync('DELETE FROM time_capsules WHERE id = ?', id); throw error; }
      if (reminderEnabled && !await scheduleTimeCapsuleNotification({ id, openAt })) {
        await setTimeCapsuleNotification(db, id, false);
        await showAppDialog({ title: '胶囊已保存', message: '系统没有授予通知权限。胶囊仍会正常到期，可以在“可开启”中找到。' });
      }
      router.replace(`/time-capsule/${encodeURIComponent(id)}` as Href);
    }
    catch { await showAppDialog({ title: '保存失败', message: '时间胶囊没有保存，请稍后再试。' }); }
    finally { setSaving(false); }
  }

  const pickerValue = new Date(parseLocalDateTime(openValue) ?? pickerMinimum.getTime());

  return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}><KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><View style={styles.header}><Pressable accessibilityLabel="取消编写时间胶囊" hitSlop={12} onPress={() => void cancelCompose()}><Text style={[styles.cancel, { color: readingTheme.secondary }]}>取消</Text></Pressable><Text style={[styles.title, { color: readingTheme.text }]}>写给未来</Text><Pressable disabled={saving || !title.trim() || !content.trim()} onPress={() => void save()}><Text style={[styles.save, (saving || !title.trim() || !content.trim()) && styles.disabled]}>{saving ? '保存中' : '封存'}</Text></Pressable></View><ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"><Text style={[styles.label, { color: readingTheme.secondary }]}>胶囊标题</Text><TextInput autoFocus maxLength={60} value={title} onChangeText={setTitle} placeholder="例如：写给明年的我" placeholderTextColor={readingTheme.secondary} style={[styles.titleInput, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} /><Text style={[styles.label, { color: readingTheme.secondary }]}>想留给未来的话</Text><TextInput multiline maxLength={10000} value={content} onChangeText={setContent} placeholder="现在的你，想对未来说些什么？" placeholderTextColor={readingTheme.secondary} textAlignVertical="top" style={[styles.contentInput, { backgroundColor: readingTheme.surface, color: readingBodyStyle.color, fontFamily: readingFontFamily, fontSize: 15 * fontScale, lineHeight: 24 * fontScale * readingBodyStyle.lineHeightMultiplier, letterSpacing: readingBodyStyle.letterSpacing }]} /><View style={styles.counterRow}><Text style={[styles.privateHint, { color: readingTheme.secondary }]}>封存后，到期前正文和媒体不可查看</Text><Text style={[styles.counter, { color: readingTheme.secondary }]}>{content.length}/10000</Text></View><Text style={[styles.label, { color: readingTheme.secondary }]}>图片与视频（最多 5 个）</Text><View style={styles.mediaRow}>{images.map((image, index) => <View key={`${image.uri}-${index}`}><MediaThumbnail media={image} allowRuntimeVideoPoster style={styles.media} /><Pressable accessibilityLabel={`移除第 ${index + 1} 个媒体`} hitSlop={10} onPress={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))} style={styles.remove}><Text style={styles.removeText}>×</Text></Pressable></View>)}{images.length < 5 ? <Pressable onPress={() => void pickMedia()} style={[styles.addMedia, { borderColor: readingTheme.border }]}><Text style={styles.addMediaText}>＋</Text></Pressable> : null}</View><Text style={[styles.label, { color: readingTheme.secondary }]}>约定开启时间</Text>{Platform.OS === 'web' ? <TextInput value={openValue} onChangeText={setOpenValue} placeholder="YYYY-MM-DD HH:mm" placeholderTextColor={readingTheme.secondary} style={[styles.timeInput, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} /> : <Pressable accessibilityLabel="选择胶囊开启时间" onPress={openDatePicker} style={[styles.timeInput, styles.timePickerButton, { backgroundColor: readingTheme.surface }]}><Text style={[styles.timePickerText, { color: readingTheme.text }]}>{openValue}</Text><Text style={styles.timePickerAction}>选择</Text></Pressable>}{pickerMode ? <DateTimePicker value={pickerValue} mode={pickerMode} minimumDate={pickerMinimum} onChange={changeDate} /> : null}<View style={styles.quickRow}><Pressable onPress={() => chooseOffset(1)} style={[styles.quick, { backgroundColor: readingTheme.surface }]}><Text style={styles.quickText}>一个月后</Text></Pressable><Pressable onPress={() => chooseOffset(6)} style={[styles.quick, { backgroundColor: readingTheme.surface }]}><Text style={styles.quickText}>半年后</Text></Pressable><Pressable onPress={() => chooseOffset(12)} style={[styles.quick, { backgroundColor: readingTheme.surface }]}><Text style={styles.quickText}>一年后</Text></Pressable></View><Pressable accessibilityRole="switch" accessibilityState={{ checked: reminderEnabled }} onPress={() => setReminderEnabled((value) => !value)} style={[styles.reminderRow, { backgroundColor: readingTheme.surface }]}><View><Text style={[styles.reminderTitle, { color: readingTheme.text }]}>到期提醒</Text><Text style={[styles.reminderText, { color: readingTheme.secondary }]}>通知不会显示胶囊标题或正文</Text></View><View style={[styles.switchTrack, reminderEnabled && styles.switchActive]}><View style={[styles.switchThumb, reminderEnabled && styles.switchThumbActive]} /></View></Pressable><View style={[styles.notice, { backgroundColor: readingTheme.surface }]}><Text style={styles.noticeIcon}>◇</Text><Text style={[styles.noticeText, { color: readingTheme.secondary }]}>即使没有通知权限或错过提醒，胶囊也不会消失，到期后仍会进入“可开启”。</Text></View></ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

const styles = StyleSheet.create({ safe: { flex: 1 }, header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl }, cancel: { fontSize: 12 }, title: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, save: { color: colors.primary, fontSize: 12, fontWeight: '800' }, disabled: { opacity: 0.3 }, scroll: { padding: spacing.xl, paddingBottom: spacing.xxxl }, label: { marginTop: spacing.lg, marginBottom: spacing.sm, fontSize: 11 }, titleInput: { minHeight: 46, paddingHorizontal: spacing.md, borderRadius: radii.md, fontSize: 14 }, contentInput: { minHeight: 220, padding: spacing.md, borderRadius: radii.md }, counterRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }, privateHint: { fontSize: 9 }, counter: { fontSize: 9 }, mediaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, media: { width: 58, height: 58, borderRadius: radii.sm }, remove: { position: 'absolute', top: -5, right: -5, width: 18, height: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: colors.overlay }, removeText: { color: '#FFFFFF', fontSize: 13 }, addMedia: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.sm }, addMediaText: { color: colors.primary, fontSize: 22 }, timeInput: { height: 46, paddingHorizontal: spacing.md, borderRadius: radii.md, fontSize: 13 }, timePickerButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, timePickerText: { fontSize: 13 }, timePickerAction: { color: colors.primary, fontSize: 11, fontWeight: '700' }, quickRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }, quick: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill }, quickText: { color: colors.primary, fontSize: 10, fontWeight: '700' }, reminderRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xl, paddingHorizontal: spacing.md, borderRadius: radii.md }, reminderTitle: { fontSize: 12, fontWeight: '700' }, reminderText: { marginTop: 2, fontSize: 9 }, switchTrack: { width: 42, height: 24, justifyContent: 'center', paddingHorizontal: 3, borderRadius: 12, backgroundColor: colors.border }, switchActive: { backgroundColor: colors.primary }, switchThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#FFFFFF' }, switchThumbActive: { alignSelf: 'flex-end' }, notice: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, padding: spacing.md, borderRadius: radii.md }, noticeIcon: { color: colors.primary, fontSize: 16 }, noticeText: { flex: 1, fontSize: 10, lineHeight: 17 } });
