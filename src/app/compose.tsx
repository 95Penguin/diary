import { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { clearDraft, createEntry, getDraft, getEntry, replaceEntryImages, replaceEntryTags, saveDraft, updateEntry } from '@/database/journal-repository';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { formatShortDateTime, occurrenceTimeForDate, parseLocalDateTime, toLocalDateTimeInput } from '@/utils/date';
import { deleteJournalImage, persistJournalImage } from '@/utils/image-storage';
import { normalizeTag } from '@/utils/tags';

type SelectedImage = { id?: string; uri: string; width: number; height: number; fileName?: string | null };

export default function ComposeScreen() {
  const db = useSQLiteContext();
  const { id, date } = useLocalSearchParams<{ id?: string; date?: string }>();
  const isEditing = Boolean(id);
  const initialOccurredAt = occurrenceTimeForDate(date ?? '', new Date());
  const [content, setContent] = useState('');
  const [occurredAt, setOccurredAt] = useState(initialOccurredAt);
  const [timeValue, setTimeValue] = useState(toLocalDateTimeInput(initialOccurredAt));
  const [editingTime, setEditingTime] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [originalContent, setOriginalContent] = useState('');
  const [originalOccurredAt, setOriginalOccurredAt] = useState('');
  const [timeChanged, setTimeChanged] = useState(false);
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [originalTags, setOriginalTags] = useState<string[]>([]);
  const [tagValue, setTagValue] = useState('');
  const [toast, setToast] = useState('');
  const inputRef = useRef<TextInput>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function leaveComposer() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  function showToast(message: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => setToast(''), 1800);
  }

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (id) {
        const entry = await getEntry(db, id);
        if (entry && active) {
          setContent(entry.content); setOccurredAt(entry.occurredAt); setTimeValue(toLocalDateTimeInput(entry.occurredAt));
          setOriginalContent(entry.content); setOriginalOccurredAt(entry.occurredAt); setTimeChanged(false); setImages(entry.images); setTags(entry.tags); setOriginalTags(entry.tags);
        } else if (active) {
          Alert.alert('记录不存在', '这条记录可能已经被删除。', [{ text: '返回', onPress: leaveComposer }]);
        }
      } else {
        const draft = await getDraft(db);
        if (draft && active) {
          const draftOccurredAt = date ? occurrenceTimeForDate(date) : draft.occurredAt;
          setContent(draft.content); setOccurredAt(draftOccurredAt); setTimeValue(toLocalDateTimeInput(draftOccurredAt)); setTags(draft.tags ?? []);
        } else if (date && active) {
          const selectedOccurredAt = occurrenceTimeForDate(date);
          setOccurredAt(selectedOccurredAt); setTimeValue(toLocalDateTimeInput(selectedOccurredAt));
        }
      }
      if (active) { setLoaded(true); setTimeout(() => inputRef.current?.focus(), 200); }
    })();
    return () => { active = false; };
  }, [date, db, id]);

  useEffect(() => {
    if (!loaded || isEditing) return;
    const timer = setTimeout(() => {
      if (content.trim()) void saveDraft(db, { content, occurredAt, updatedAt: new Date().toISOString(), tags });
      else void clearDraft(db);
    }, 500);
    return () => clearTimeout(timer);
  }, [content, db, isEditing, loaded, occurredAt, tags]);

  function applyTime() {
    const parsed = parseLocalDateTime(timeValue);
    if (!parsed) { Alert.alert('时间格式不正确', '请使用 YYYY-MM-DD HH:mm，例如 2026-07-19 14:36。'); return; }
    setOccurredAt(parsed); setTimeChanged(true); setEditingTime(false);
  }

  function addImages(assets: ImagePicker.ImagePickerAsset[]) {
    setImages((current) => [
      ...current,
      ...assets.slice(0, 9 - current.length).map((asset) => ({
        uri: asset.uri, width: asset.width, height: asset.height, fileName: asset.fileName,
      })),
    ]);
  }

  async function chooseFromLibrary() {
    const remaining = 9 - images.length;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: remaining, quality: 0.85,
    });
    if (!result.canceled) addImages(result.assets);
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { Alert.alert('无法使用相机', '请在系统设置中允许拾时使用相机。'); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (!result.canceled) addImages(result.assets);
  }

  function openImageMenu() {
    if (images.length >= 9) { Alert.alert('最多添加 9 张图片'); return; }
    Alert.alert('添加图片', undefined, [
      { text: '从相册选择', onPress: () => void chooseFromLibrary() },
      { text: '拍照', onPress: () => void takePhoto() },
      { text: '取消', style: 'cancel' },
    ]);
  }

  function addTag(value = tagValue) {
    const cleaned = value.trim().replace(/^#+/, '').replace(/[#,，\s]+/g, '');
    if (cleaned.length > 12) {
      setTagValue(cleaned);
      showToast('标签最多 12 个字符');
      return;
    }
    const tag = normalizeTag(value);
    if (!tag) { setTagValue(''); return; }
    if (tags.some((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase())) {
      setTagValue('');
      showToast(`标签已存在：#${tag}`);
      return;
    }
    if (tags.length >= 5) { showToast('每条记录最多添加 5 个标签'); return; }
    setTags((current) => [...current, tag]); setTagValue('');
  }

  function changeTagValue(value: string) {
    if (/[,，\s]$/.test(value)) addTag(value);
    else setTagValue(value);
  }

  async function save() {
    if (!content.trim() || saving) return;
    setSaving(true);
    const newlyPersisted: string[] = [];
    try {
      const savedImages = await Promise.all(images.map(async (image) => {
        if (image.id) return image;
        const uri = await persistJournalImage(image.uri, image.fileName);
        newlyPersisted.push(uri);
        return { ...image, uri };
      }));
      let entryId = id;
      if (id) {
        // Editing text must never move an older entry to today. Only an explicitly
        // confirmed time change is allowed to replace the original occurrence time.
        await updateEntry(db, id, { content, occurredAt: timeChanged ? occurredAt : originalOccurredAt });
      } else {
        entryId = await createEntry(db, { content, occurredAt });
        await clearDraft(db);
      }
      if (!entryId) throw new Error('Missing entry id');
      const removedUris = await replaceEntryImages(db, entryId, savedImages);
      await replaceEntryTags(db, entryId, tags);
      removedUris.forEach(deleteJournalImage);
      if (id) leaveComposer();
      else router.replace({ pathname: '/entry/[id]', params: { id: entryId } });
    } catch {
      newlyPersisted.forEach(deleteJournalImage);
      Alert.alert('保存失败', '这次内容还没有完整保存，请稍后重试。'); setSaving(false);
    }
  }

  function cancel() {
    const hasChanges = content !== originalContent || occurredAt !== originalOccurredAt || JSON.stringify(tags) !== JSON.stringify(originalTags);
    if (isEditing && hasChanges) Alert.alert('退出编辑？', '尚未保存的修改会丢失。', [{ text: '继续编辑', style: 'cancel' }, { text: '退出', style: 'destructive', onPress: leaveComposer }]);
    else leaveComposer();
  }

  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.header}>
        <Pressable onPress={cancel} hitSlop={12}><Text style={styles.headerAction}>取消</Text></Pressable>
        <Text style={styles.title}>{isEditing ? '编辑' : '记录此刻'}</Text>
        <Pressable disabled={!content.trim() || saving} onPress={() => void save()} style={[styles.save, (!content.trim() || saving) && styles.saveDisabled]}><Text style={styles.saveText}>{saving ? '保存中' : '保存'}</Text></Pressable>
      </View>
      {toast ? <View pointerEvents="none" style={styles.toast}><Text style={styles.toastText}>{toast}</Text></View> : null}

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {editingTime ? <View style={styles.timeEditor}>
          <TextInput autoFocus value={timeValue} onChangeText={setTimeValue} placeholder="YYYY-MM-DD HH:mm" style={styles.timeInput} />
          <Pressable onPress={applyTime}><Text style={styles.apply}>确定</Text></Pressable>
        </View> : <Pressable onPress={() => setEditingTime(true)} style={styles.timeChip}><Text style={styles.timeChipText}>发生于　{formatShortDateTime(occurredAt)}　›</Text></Pressable>}
        <TextInput ref={inputRef} multiline maxLength={10000} value={content} onChangeText={setContent} placeholder="写下现在发生的事……" placeholderTextColor={colors.textFaint} textAlignVertical="top" style={styles.editor} />
        <View style={styles.imageRow}>
          {images.map((image, index) => <View key={`${image.uri}-${index}`} style={styles.imageItem}>
            <Image source={image.uri} contentFit="cover" style={styles.imagePreview} />
            <Pressable accessibilityLabel="移除图片" onPress={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))} style={styles.removeImage}><Text style={styles.removeImageText}>×</Text></Pressable>
          </View>)}
          {images.length < 9 ? <Pressable accessibilityLabel="添加图片" onPress={openImageMenu} style={styles.addImage}><Text style={styles.addImageIcon}>＋</Text><Text style={styles.addImageText}>图片</Text></Pressable> : null}
        </View>
        <View style={styles.tagEditor}>
          {tags.map((tag) => <Pressable accessibilityLabel={`移除标签 ${tag}`} key={tag} onPress={() => setTags((current) => current.filter((item) => item !== tag))} style={styles.tagChip}><Text style={styles.tagChipText}>#{tag}　×</Text></Pressable>)}
          {tags.length < 5 ? <TextInput value={tagValue} onChangeText={changeTagValue} onSubmitEditing={() => addTag()} returnKeyType="done" placeholder="＋ 标签" placeholderTextColor={colors.textFaint} style={styles.tagInput} /> : null}
        </View>
        <View style={styles.editorMeta}><Text style={styles.draft}>{!isEditing && content ? '草稿已自动保存' : '不需要标题，写下一句话也可以'}</Text><Text style={styles.counter}>{content.length}/10000</Text></View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, keyboard: { flex: 1 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  title: { color: colors.text, fontFamily: fonts.serif, fontSize: 16, lineHeight: 24, fontWeight: '600', includeFontPadding: false }, headerAction: { color: colors.textSecondary, fontSize: 13 },
  save: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.primary }, saveDisabled: { opacity: 0.35 }, saveText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  toast: { position: 'absolute', top: 62, left: spacing.xl, right: spacing.xl, zIndex: 20, alignItems: 'center' }, toastText: { overflow: 'hidden', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radii.pill, backgroundColor: '#31483EED', color: '#FFFFFF', fontSize: 11 },
  body: { flexGrow: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  timeChip: { alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.sm, backgroundColor: colors.primarySoft }, timeChipText: { color: colors.primary, fontSize: 11 },
  timeEditor: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, timeInput: { flex: 1, height: 42, paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted, color: colors.text }, apply: { color: colors.primary, fontWeight: '700' },
  tagEditor: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  tagChip: { paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: colors.primarySoft }, tagChipText: { color: colors.primary, fontSize: 10 },
  tagInput: { minWidth: 72, height: 28, paddingHorizontal: spacing.sm, paddingVertical: 0, color: colors.text, fontSize: 10 },
  imageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  imageItem: { position: 'relative' }, imagePreview: { width: 64, height: 64, borderRadius: radii.sm, backgroundColor: colors.surfaceMuted },
  removeImage: { position: 'absolute', top: -5, right: -5, width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.overlay }, removeImageText: { color: '#FFFFFF', fontSize: 16, lineHeight: 18 },
  addImage: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radii.sm }, addImageIcon: { color: colors.primary, fontSize: 21, lineHeight: 24 }, addImageText: { color: colors.textFaint, fontSize: 9 },
  editor: { minHeight: 150, paddingTop: spacing.lg, color: colors.text, fontFamily: fonts.serif, fontSize: 16, lineHeight: 25, includeFontPadding: false }, editorMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md }, draft: { color: colors.textFaint, fontSize: 10 }, counter: { color: colors.textFaint, fontSize: 9 },
});
