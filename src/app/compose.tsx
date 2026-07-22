import { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { createDraftId, createEntryWithDetails, deleteDraft, getDraft, getEntry, saveDraft, updateEntryWithDetails } from '@/database/journal-repository';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { formatShortDateTime, occurrenceTimeForDate, parseLocalDateTime, toLocalDateTimeInput } from '@/utils/date';
import { deleteJournalImage, persistJournalImage } from '@/utils/image-storage';
import { normalizeTag } from '@/utils/tags';
import { useAppPreferences } from '@/preferences/app-preferences';
import { AppDialog } from '@/components/app-dialog';

type SelectedImage = { id?: string; uri: string; width: number; height: number; fileName?: string | null; draftOwned?: boolean };
const MOODS = ['开心', '平静', '期待', '难过', '疲惫', '生气'] as const;
const MOOD_ICONS: Record<string, string> = { 开心: '😊', 平静: '😌', 期待: '✨', 难过: '😔', 疲惫: '😴', 生气: '😤' };
const WEATHERS = ['晴', '多云', '阴', '雨', '雷雨', '雪', '雾'] as const;
const WEATHER_ICONS: Record<string, string> = { 晴: '☀️', 多云: '⛅', 阴: '☁️', 雨: '🌧️', 雷雨: '⛈️', 雪: '🌨️', 雾: '🌫️' };

export default function ComposeScreen() {
  const db = useSQLiteContext();
  const { fontScale, readingFontFamily, readingTheme } = useAppPreferences();
  const { id, date, draft: requestedDraftId } = useLocalSearchParams<{ id?: string; date?: string; draft?: string }>();
  const isEditing = Boolean(id);
  const initialOccurredAt = occurrenceTimeForDate(date ?? '', new Date());
  const [content, setContent] = useState('');
  const [occurredAt, setOccurredAt] = useState(initialOccurredAt);
  const [timeValue, setTimeValue] = useState(toLocalDateTimeInput(initialOccurredAt));
  const [editingTime, setEditingTime] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(requestedDraftId ?? null);
  const [originalContent, setOriginalContent] = useState('');
  const [originalOccurredAt, setOriginalOccurredAt] = useState('');
  const [timeChanged, setTimeChanged] = useState(false);
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [originalImageUris, setOriginalImageUris] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [mood, setMood] = useState<string | null>(null);
  const [weather, setWeather] = useState<string | null>(null);
  const [activeMeta, setActiveMeta] = useState<'mood' | 'weather' | 'location' | 'tags' | null>(null);
  const [locationName, setLocationName] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [originalTags, setOriginalTags] = useState<string[]>([]);
  const [originalMood, setOriginalMood] = useState<string | null>(null);
  const [originalWeather, setOriginalWeather] = useState<string | null>(null);
  const [originalLocationName, setOriginalLocationName] = useState('');
  const [tagValue, setTagValue] = useState('');
  const [toast, setToast] = useState('');
  const [imageMenuVisible, setImageMenuVisible] = useState(false);
  const [exitConfirmationVisible, setExitConfirmationVisible] = useState(false);
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
          setOriginalContent(entry.content); setOriginalOccurredAt(entry.occurredAt); setTimeChanged(false); setImages(entry.images); setOriginalImageUris(entry.images.map((image) => image.uri)); setTags(entry.tags); setOriginalTags(entry.tags); setMood(entry.mood); setOriginalMood(entry.mood); setWeather(entry.weather); setOriginalWeather(entry.weather); setLocationName(entry.locationName ?? ''); setOriginalLocationName(entry.locationName ?? ''); setLatitude(entry.latitude); setLongitude(entry.longitude);
        } else if (active) {
          Alert.alert('记录不存在', '这条记录可能已经被删除。', [{ text: '返回', onPress: leaveComposer }]);
        }
      } else if (requestedDraftId) {
        const draft = await getDraft(db, requestedDraftId);
        if (draft && active) {
          setContent(draft.content); setOccurredAt(draft.occurredAt); setTimeValue(toLocalDateTimeInput(draft.occurredAt)); setTags(draft.tags); setMood(draft.mood); setWeather(draft.weather);
          setLocationName(draft.locationName ?? ''); setLatitude(draft.latitude); setLongitude(draft.longitude);
          setImages(draft.images.map((image) => ({ ...image, id: 'draft-image', draftOwned: true })));
        } else if (active) {
          Alert.alert('草稿不存在', '这份草稿可能已经被删除。', [{ text: '返回', onPress: leaveComposer }]);
        }
      } else {
        if (date && active) {
          const selectedOccurredAt = occurrenceTimeForDate(date);
          setOccurredAt(selectedOccurredAt); setTimeValue(toLocalDateTimeInput(selectedOccurredAt));
        }
      }
      if (active) { setLoaded(true); setTimeout(() => inputRef.current?.focus(), 200); }
    })();
    return () => { active = false; };
  }, [date, db, id, requestedDraftId]);

  useEffect(() => {
    if (!loaded || isEditing || saving) return;
    const timer = setTimeout(() => {
      const hasDraft = Boolean(content.trim() || images.length || tags.length || mood || weather || locationName.trim());
      if (hasDraft) {
        const nextId = activeDraftId ?? createDraftId();
        if (!activeDraftId) setActiveDraftId(nextId);
        void saveDraft(db, { id: nextId, content, occurredAt, updatedAt: new Date().toISOString(), tags, mood, weather, images: images.map(({ uri, width, height }) => ({ uri, width, height })), locationName: locationName.trim() || null, latitude, longitude })
          .catch(() => showToast('草稿自动保存失败'));
      } else if (activeDraftId) {
        void deleteDraft(db, activeDraftId).then((uris) => uris.forEach(deleteJournalImage)).catch(() => showToast('草稿清理失败'));
        setActiveDraftId(null);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [activeDraftId, content, db, images, isEditing, latitude, loaded, locationName, longitude, mood, occurredAt, saving, tags, weather]);

  async function fillCurrentLocation() {
    if (locating) return;
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) { Alert.alert('无法读取位置', '可以在系统设置中允许位置权限，或直接手动填写地点。'); return; }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude: nextLatitude, longitude: nextLongitude } = position.coords;
      const addresses = await Location.reverseGeocodeAsync({ latitude: nextLatitude, longitude: nextLongitude });
      const address = addresses[0];
      const parts = [address?.name, address?.district, address?.city].filter((item, index, values): item is string => Boolean(item) && values.indexOf(item) === index);
      setLocationName(address?.formattedAddress || parts.join(' · ') || `${nextLatitude.toFixed(5)}, ${nextLongitude.toFixed(5)}`);
      setLatitude(nextLatitude); setLongitude(nextLongitude);
    } catch { Alert.alert('定位失败', '暂时无法获取当前位置，可以稍后重试或手动填写。'); }
    finally { setLocating(false); }
  }

  function applyTime() {
    const parsed = parseLocalDateTime(timeValue);
    if (!parsed) { Alert.alert('时间格式不正确', '请使用 YYYY-MM-DD HH:mm，例如 2026-07-19 14:36。'); return; }
    setOccurredAt(parsed); setTimeChanged(true); setEditingTime(false);
  }

  async function addImages(assets: ImagePicker.ImagePickerAsset[]) {
    try {
      const persisted = await Promise.all(assets.slice(0, 9 - images.length).map(async (asset) => ({
        id: 'draft-image', uri: await persistJournalImage(asset.uri, asset.fileName), width: asset.width, height: asset.height, draftOwned: true,
      })));
      setImages((current) => [...current, ...persisted.slice(0, 9 - current.length)]);
    } catch { Alert.alert('图片添加失败', '图片没有保存，请稍后重试。'); }
  }

  async function chooseFromLibrary() {
    const remaining = 9 - images.length;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: remaining, quality: 0.85,
    });
    if (!result.canceled) await addImages(result.assets);
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { Alert.alert('无法使用相机', '请在系统设置中允许拾时使用相机。'); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (!result.canceled) await addImages(result.assets);
  }

  function openImageMenu() {
    if (images.length >= 9) { Alert.alert('最多添加 9 张图片'); return; }
    setImageMenuVisible(true);
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
      let removedUris: string[] = [];
      if (id) {
        // Editing text must never move an older entry to today. Only an explicitly
        // confirmed time change is allowed to replace the original occurrence time.
        removedUris = await updateEntryWithDetails(
          db, id, { content, occurredAt: timeChanged ? occurredAt : originalOccurredAt, mood, weather, locationName, latitude, longitude }, savedImages, tags,
        );
      } else {
        entryId = await createEntryWithDetails(db, { content, occurredAt, mood, weather, locationName, latitude, longitude }, savedImages, tags);
        if (activeDraftId) await deleteDraft(db, activeDraftId, true);
      }
      if (!entryId) throw new Error('Missing entry id');
      removedUris.forEach(deleteJournalImage);
      if (id) leaveComposer();
      else router.replace({ pathname: '/entry/[id]', params: { id: entryId } });
    } catch {
      newlyPersisted.forEach(deleteJournalImage);
      Alert.alert('保存失败', '这次内容还没有完整保存，请稍后重试。'); setSaving(false);
    }
  }

  async function persistCurrentDraft() {
    if (isEditing || !(content.trim() || images.length || tags.length || mood || weather || locationName.trim())) return;
    const nextId = activeDraftId ?? createDraftId();
    if (!activeDraftId) setActiveDraftId(nextId);
    try {
      await saveDraft(db, { id: nextId, content, occurredAt, updatedAt: new Date().toISOString(), tags, mood, weather, images: images.map(({ uri, width, height }) => ({ uri, width, height })), locationName: locationName.trim() || null, latitude, longitude });
    } catch {
      Alert.alert('草稿保存失败', '当前内容暂时无法写入草稿箱，请返回后再次确认。');
      throw new Error('draft-save-failed');
    }
  }

  async function cancel() {
    const hasChanges = content !== originalContent || occurredAt !== originalOccurredAt || mood !== originalMood || weather !== originalWeather || locationName !== originalLocationName || JSON.stringify(images.map((image) => image.uri)) !== JSON.stringify(originalImageUris) || JSON.stringify(tags) !== JSON.stringify(originalTags);
    if (isEditing && hasChanges) setExitConfirmationVisible(true);
    else {
      try { await persistCurrentDraft(); leaveComposer(); }
      catch { /* Keep the composer open so the user can retry. */ }
    }
  }

  return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.header}>
        <Pressable onPress={() => void cancel()} hitSlop={12}><Text style={styles.headerAction}>取消</Text></Pressable>
        <Text style={styles.title}>{isEditing ? '编辑' : '记录此刻'}</Text>
        <Pressable disabled={!content.trim() || saving} onPress={() => void save()} style={[styles.save, (!content.trim() || saving) && styles.saveDisabled]}><Text style={styles.saveText}>{saving ? '保存中' : '保存'}</Text></Pressable>
      </View>
      {toast ? <View pointerEvents="none" style={styles.toast}><Text style={styles.toastText}>{toast}</Text></View> : null}

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {editingTime ? <View style={styles.timeEditor}>
          <TextInput autoFocus value={timeValue} onChangeText={setTimeValue} placeholder="YYYY-MM-DD HH:mm" style={styles.timeInput} />
          <Pressable onPress={applyTime}><Text style={styles.apply}>确定</Text></Pressable>
        </View> : <Pressable onPress={() => setEditingTime(true)} style={styles.timeChip}><Text style={styles.timeChipText}>发生于　{formatShortDateTime(occurredAt)}　›</Text></Pressable>}
        <TextInput ref={inputRef} multiline maxLength={10000} value={content} onChangeText={setContent} placeholder="写下现在发生的事……" placeholderTextColor={readingTheme.secondary} textAlignVertical="top" style={[styles.editor, { color: readingTheme.text, fontFamily: readingFontFamily, fontSize: 18 * fontScale, lineHeight: 30 * fontScale }]} />
        <View style={styles.imageRow}>
          {images.map((image, index) => <View key={`${image.uri}-${index}`} style={styles.imageItem}>
            <Image source={image.uri} contentFit="cover" style={styles.imagePreview} />
            <Pressable accessibilityLabel="移除图片" onPress={() => { if (image.draftOwned) deleteJournalImage(image.uri); setImages((current) => current.filter((_, itemIndex) => itemIndex !== index)); }} style={styles.removeImage}><Text style={styles.removeImageText}>×</Text></Pressable>
          </View>)}
          {images.length < 9 ? <Pressable accessibilityLabel="添加图片" onPress={openImageMenu} style={styles.addImage}><Text style={styles.addImageIcon}>＋</Text><Text style={styles.addImageText}>图片</Text></Pressable> : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.metaToolbarScroll} contentContainerStyle={styles.metaToolbar}>
          <Pressable onPress={() => setActiveMeta((value) => value === 'mood' ? null : 'mood')} style={[styles.metaButton, activeMeta === 'mood' && styles.metaButtonActive]}><Text style={[styles.metaButtonText, activeMeta === 'mood' && styles.metaButtonTextActive]}>{mood ? `${MOOD_ICONS[mood]} ${mood}` : '＋ 心情'}</Text></Pressable>
          <Pressable onPress={() => setActiveMeta((value) => value === 'weather' ? null : 'weather')} style={[styles.metaButton, activeMeta === 'weather' && styles.metaButtonActive]}><Text style={[styles.metaButtonText, activeMeta === 'weather' && styles.metaButtonTextActive]}>{weather ? `${WEATHER_ICONS[weather]} ${weather}` : '＋ 天气'}</Text></Pressable>
          <Pressable onPress={() => setActiveMeta((value) => value === 'location' ? null : 'location')} style={[styles.metaButton, activeMeta === 'location' && styles.metaButtonActive]}><Text numberOfLines={1} style={[styles.metaButtonText, styles.locationMetaText, activeMeta === 'location' && styles.metaButtonTextActive]}>{locationName ? `⌖ ${locationName}` : '＋ 地点'}</Text></Pressable>
          <Pressable onPress={() => setActiveMeta((value) => value === 'tags' ? null : 'tags')} style={[styles.metaButton, activeMeta === 'tags' && styles.metaButtonActive]}><Text style={[styles.metaButtonText, activeMeta === 'tags' && styles.metaButtonTextActive]}>{tags.length ? `# ${tags.length} 个标签` : '＋ 标签'}</Text></Pressable>
        </ScrollView>
        {activeMeta === 'mood' ? <View style={styles.metaEditor}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.moods}>
          {MOODS.map((item) => <Pressable accessibilityLabel={`心情：${item}`} key={item} onPress={() => setMood((current) => current === item ? null : item)} style={[styles.moodChip, mood === item && styles.moodChipActive]}><Text style={[styles.moodText, mood === item && styles.moodTextActive]}>{MOOD_ICONS[item]} {item}</Text></Pressable>)}
        </ScrollView></View> : null}
        {activeMeta === 'weather' ? <View style={styles.metaEditor}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.moods}>
          {WEATHERS.map((item) => <Pressable accessibilityLabel={`天气：${item}`} key={item} onPress={() => setWeather((current) => current === item ? null : item)} style={[styles.moodChip, weather === item && styles.moodChipActive]}><Text style={[styles.moodText, weather === item && styles.moodTextActive]}>{WEATHER_ICONS[item]} {item}</Text></Pressable>)}
        </ScrollView></View> : null}
        {activeMeta === 'location' ? <View style={styles.metaEditor}><View style={styles.locationRow}><TextInput maxLength={100} value={locationName} onChangeText={(value) => { setLocationName(value); setLatitude(null); setLongitude(null); }} placeholder="手动填写地点（可选）" placeholderTextColor={colors.textFaint} style={styles.locationInput} /><Pressable accessibilityLabel="使用当前位置" disabled={locating} onPress={() => void fillCurrentLocation()} style={styles.locationButton}><Text style={styles.locationButtonText}>{locating ? '定位中…' : '⌖ 当前位置'}</Text></Pressable></View></View> : null}
        {activeMeta === 'tags' ? <View style={[styles.metaEditor, styles.tagEditor]}>
          {tags.map((tag) => <Pressable accessibilityLabel={`移除标签 ${tag}`} key={tag} onPress={() => setTags((current) => current.filter((item) => item !== tag))} style={styles.tagChip}><Text style={styles.tagChipText}>#{tag}　×</Text></Pressable>)}
          {tags.length < 5 ? <TextInput value={tagValue} onChangeText={changeTagValue} onSubmitEditing={() => addTag()} returnKeyType="done" placeholder="＋ 输入标签" placeholderTextColor={colors.textFaint} style={styles.tagInput} /> : null}
        </View> : null}
        <View style={styles.editorMeta}><Text style={styles.draft}>{!isEditing && activeDraftId ? '已自动保存到草稿箱' : '不需要标题，写下一句话也可以'}</Text><Text style={styles.counter}>{content.length}/10000</Text></View>
      </ScrollView>
    </KeyboardAvoidingView>
    <AppDialog visible={imageMenuVisible} title="添加图片" onClose={() => setImageMenuVisible(false)} actions={[{ label: '相册', tone: 'primary', onPress: () => { setImageMenuVisible(false); void chooseFromLibrary(); } }, { label: '拍照', onPress: () => { setImageMenuVisible(false); void takePhoto(); } }]} />
    <AppDialog visible={exitConfirmationVisible} title="退出编辑？" message="尚未保存的修改会丢失。" onClose={() => setExitConfirmationVisible(false)} actions={[{ label: '继续编辑', onPress: () => setExitConfirmationVisible(false) }, { label: '退出', tone: 'danger', onPress: () => { setExitConfirmationVisible(false); images.filter((image) => image.draftOwned).forEach((image) => deleteJournalImage(image.uri)); leaveComposer(); } }]} />
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
  metaToolbarScroll: { flexGrow: 0, marginTop: spacing.md }, metaToolbar: { alignItems: 'center', gap: spacing.xs }, metaButton: { maxWidth: 170, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted }, metaButtonActive: { backgroundColor: colors.primarySoft }, metaButtonText: { color: colors.textSecondary, fontSize: 10, fontWeight: '600' }, metaButtonTextActive: { color: colors.primary }, locationMetaText: { maxWidth: 145 }, metaEditor: { marginTop: spacing.sm, padding: spacing.sm, borderRadius: radii.md, backgroundColor: colors.surface }, moods: { gap: spacing.xs },
  moodChip: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted }, moodChipActive: { backgroundColor: colors.primary }, moodText: { color: colors.textSecondary, fontSize: 10 }, moodTextActive: { color: '#FFFFFF' },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, locationInput: { flex: 1, height: 38, paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted, color: colors.text, fontSize: 11 }, locationButton: { height: 38, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: colors.primarySoft }, locationButtonText: { color: colors.primary, fontSize: 10, fontWeight: '600' },
  tagEditor: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  tagChip: { paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: colors.primarySoft }, tagChipText: { color: colors.primary, fontSize: 10 },
  tagInput: { minWidth: 72, height: 28, paddingHorizontal: spacing.sm, paddingVertical: 0, color: colors.text, fontSize: 10 },
  imageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  imageItem: { position: 'relative' }, imagePreview: { width: 64, height: 64, borderRadius: radii.sm, backgroundColor: 'transparent' },
  removeImage: { position: 'absolute', top: -5, right: -5, width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.overlay }, removeImageText: { color: '#FFFFFF', fontSize: 16, lineHeight: 18 },
  addImage: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radii.sm }, addImageIcon: { color: colors.primary, fontSize: 21, lineHeight: 24 }, addImageText: { color: colors.textFaint, fontSize: 9 },
  editor: { minHeight: 150, paddingTop: spacing.lg, color: colors.text, fontFamily: fonts.serif, fontSize: 16, lineHeight: 25, includeFontPadding: false }, editorMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md }, draft: { color: colors.textFaint, fontSize: 10 }, counter: { color: colors.textFaint, fontSize: 9 },
});
