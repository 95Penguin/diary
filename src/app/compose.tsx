import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { AppState, BackHandler, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { reGeocode } from 'expo-gaode-map';
import { SymbolView } from 'expo-symbols';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { createDraftId, createEntryWithDetails, deleteDraft, getDraft, getEntry, getLocationPageDetail, isNewFootprintLocation, listEntryFilterOptions, saveDraft, saveLocationDetail, saveMediaMetadata, updateEntryWithDetails, type EntryFilterOptions } from '@/database/journal-repository';
import { listJournalTemplates } from '@/database/template-repository';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { formatShortDateTime, occurrenceTimeForDate, parseLocalDateTime, toLocalDateTimeInput } from '@/utils/date';
import { deleteJournalImage, persistJournalImage } from '@/utils/image-storage';
import { normalizeTag } from '@/utils/tags';
import { useAppPreferences } from '@/preferences/app-preferences';
import { AppDialog } from '@/components/app-dialog';
import { showAppDialog } from '@/components/app-dialog-host';
import { DraggableMediaItem } from '@/components/draggable-media-item';
import { MediaThumbnail } from '@/components/media-view';
import type { JournalMediaType } from '@/domain/journal';
import { getPickerMediaType, preparePickedMedia } from '@/utils/picker-media';
import { createPersistentVideoThumbnail } from '@/utils/video-thumbnail-cache';
import { createPersistentImageThumbnail } from '@/utils/image-thumbnail-cache';
import { journalPickerOptions, pickedMediaMetadata, pickedMediaSizeLabel } from '@/utils/image-quality';
import { prepareImagesForStorage } from '@/utils/image-processing';
import { formatLocationName } from '@/utils/location-name';
import { LocationPickerModal } from '@/components/location-picker-modal';
import { applyJournalTemplate, JOURNAL_TEMPLATES, type JournalTemplate } from '@/utils/journal-templates';
import { recordAppError } from '@/utils/app-error-log';
import { applyLocationPrivacy, type CoordinatePrivacyChoice } from '@/utils/location-privacy';
import { wgs84ToGcj02 } from '@/utils/china-coordinates';
import { rankNearbyPois } from '@/utils/location-poi';

type SelectedImage = { id?: string; uri: string; width: number; height: number; fileName?: string | null; draftOwned?: boolean; mediaType?: JournalMediaType; pairedVideoUri?: string | null; pairedVideoFileName?: string | null; duration?: number | null; thumbnailUri?: string | null };
const MOODS = ['开心', '平静', '期待', '激动', '感动', '紧张', '焦虑', '难过', '疲惫', '生气'] as const;
const MOOD_ICONS: Record<string, string> = { 开心: '😊', 平静: '😌', 期待: '✨', 激动: '🤩', 感动: '🥹', 紧张: '😰', 焦虑: '😟', 难过: '😔', 疲惫: '😴', 生气: '😤' };
const WEATHERS = ['晴', '多云', '阴', '雨', '雷雨', '雪', '雾', '风', '霾'] as const;
const WEATHER_ICONS: Record<string, string> = { 晴: '☀️', 多云: '⛅', 阴: '☁️', 雨: '🌧️', 雷雨: '⛈️', 雪: '🌨️', 雾: '🌫️', 风: '🌬️', 霾: '😷' };
const EMPTY_SUGGESTIONS: EntryFilterOptions = { locations: [], tags: [], moods: [], weather: [] };

export default function ComposeScreen() {
  const db = useSQLiteContext();
  const { preferences, fontScale, readingBodyStyle, readingFontFamily, readingTheme } = useAppPreferences();
  const { id, date, draft: requestedDraftId, quick } = useLocalSearchParams<{ id?: string; date?: string; draft?: string; quick?: string }>();
  const isEditing = Boolean(id);
  const initialOccurredAt = occurrenceTimeForDate(date ?? '', new Date());
  const [content, setContent] = useState('');
  const [occurredAt, setOccurredAt] = useState(initialOccurredAt);
  const [timeValue, setTimeValue] = useState(toLocalDateTimeInput(initialOccurredAt));
  const [editingTime, setEditingTime] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftStatus, setDraftStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [activeDraftId, setActiveDraftId] = useState<string | null>(requestedDraftId ?? null);
  const activeDraftIdRef = useRef<string | null>(requestedDraftId ?? null);
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
  const [locationAddress, setLocationAddress] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [locationCoordinateChanged, setLocationCoordinateChanged] = useState(false);
  const [locationPickerVisible, setLocationPickerVisible] = useState(false);
  const [templatePickerVisible, setTemplatePickerVisible] = useState(false);
  const [journalTemplates, setJournalTemplates] = useState<JournalTemplate[]>(JOURNAL_TEMPLATES);
  const [locating, setLocating] = useState(false);
  const [locationStatus, setLocationStatus] = useState('');
  const [originalTags, setOriginalTags] = useState<string[]>([]);
  const [originalMood, setOriginalMood] = useState<string | null>(null);
  const [originalWeather, setOriginalWeather] = useState<string | null>(null);
  const [originalLocationName, setOriginalLocationName] = useState('');
  const [tagValue, setTagValue] = useState('');
  const [toast, setToast] = useState('');
  const [imageMenuVisible, setImageMenuVisible] = useState(false);
  const [exitConfirmationVisible, setExitConfirmationVisible] = useState(false);
  const [quickMode, setQuickMode] = useState(quick === '1' && !id && !requestedDraftId);
  const [locationDialog, setLocationDialog] = useState<{ title: string; message: string; settings?: boolean } | null>(null);
  const [suggestions, setSuggestions] = useState<EntryFilterOptions>(EMPTY_SUGGESTIONS);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const undoBatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationRequestRef = useRef(0);
  const addressRequestRef = useRef(0);
  const draftSaveVersionRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);

  function leaveComposer() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  function showToast(message: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => setToast(''), 1800);
  }

  function changeContent(next: string) {
    if (content === next) return;
    if (!undoBatchTimerRef.current) {
      undoStackRef.current = [...undoStackRef.current.slice(-49), content];
    }
    if (undoBatchTimerRef.current) clearTimeout(undoBatchTimerRef.current);
    undoBatchTimerRef.current = setTimeout(() => { undoBatchTimerRef.current = null; }, 700);
    redoStackRef.current = [];
    setCanUndo(Boolean(undoStackRef.current.length));
    setCanRedo(false);
    setContent(next);
  }

  function undoContent() {
    const previous = undoStackRef.current.at(-1);
    if (previous === undefined) return;
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current.slice(-49), content];
    if (undoBatchTimerRef.current) clearTimeout(undoBatchTimerRef.current);
    undoBatchTimerRef.current = null;
    setCanUndo(Boolean(undoStackRef.current.length));
    setCanRedo(true);
    setContent(previous);
  }

  function redoContent() {
    const next = redoStackRef.current.at(-1);
    if (next === undefined) return;
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current.slice(-49), content];
    if (undoBatchTimerRef.current) clearTimeout(undoBatchTimerRef.current);
    undoBatchTimerRef.current = null;
    setCanUndo(true);
    setCanRedo(Boolean(redoStackRef.current.length));
    setContent(next);
  }

  function applyTemplate(template: JournalTemplate) {
    const next = applyJournalTemplate(content, template);
    if (next.length > 10000) {
      showToast(`正文最多 10000 字，当前还可加入 ${Math.max(0, 10000 - content.length)} 字`);
      return;
    }
    changeContent(next);
    setTemplatePickerVisible(false);
    showToast(content.trim() ? `已在正文后追加“${template.title}”` : `已使用“${template.title}”`);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (undoBatchTimerRef.current) clearTimeout(undoBatchTimerRef.current);
    locationRequestRef.current += 1;
    addressRequestRef.current += 1;
  }, []);

  useEffect(() => {
    void listEntryFilterOptions(db).then(setSuggestions).catch(() => { /* Suggestions are optional. */ });
    void listJournalTemplates(db).then(setJournalTemplates).catch(() => { /* System templates remain available. */ });
  }, [db]);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (id) {
        const entry = await getEntry(db, id);
        if (entry && active) {
          setContent(entry.content); setOccurredAt(entry.occurredAt); setTimeValue(toLocalDateTimeInput(entry.occurredAt));
          setOriginalContent(entry.content); setOriginalOccurredAt(entry.occurredAt); setTimeChanged(false); setImages(entry.images); setOriginalImageUris(entry.images.map((image) => image.uri)); setTags(entry.tags); setOriginalTags(entry.tags); setMood(entry.mood); setOriginalMood(entry.mood); setWeather(entry.weather); setOriginalWeather(entry.weather); setLocationName(entry.locationName ?? ''); setOriginalLocationName(entry.locationName ?? ''); setLatitude(entry.latitude); setLongitude(entry.longitude);
          if (entry.locationName) {
            const detail = await getLocationPageDetail(db, entry.locationName);
            if (active) setLocationAddress(detail?.address ?? '');
          }
        } else if (active) {
          await showAppDialog({ title: '记录不存在', message: '这条记录可能已经被删除。' });
          leaveComposer();
        }
      } else if (requestedDraftId) {
        const draft = await getDraft(db, requestedDraftId);
        if (draft && active) {
          setContent(draft.content); setOccurredAt(draft.occurredAt); setTimeValue(toLocalDateTimeInput(draft.occurredAt)); setTags(draft.tags); setMood(draft.mood); setWeather(draft.weather);
          setLocationName(draft.locationName ?? ''); setLatitude(draft.latitude); setLongitude(draft.longitude);
          setImages(draft.images.map((image) => ({ ...image, id: 'draft-image', draftOwned: true })));
        } else if (active) {
          await showAppDialog({ title: '草稿不存在', message: '这份草稿可能已经被删除。' });
          leaveComposer();
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
        const saveVersion = ++draftSaveVersionRef.current;
        setDraftStatus('saving');
        const nextId = activeDraftIdRef.current ?? createDraftId();
        if (!activeDraftIdRef.current) { activeDraftIdRef.current = nextId; setActiveDraftId(nextId); }
        void saveDraft(db, { id: nextId, content, occurredAt, updatedAt: new Date().toISOString(), tags, mood, weather, images: images.map(({ uri, width, height, mediaType, pairedVideoUri, duration, thumbnailUri }) => ({ uri, width, height, mediaType, pairedVideoUri, duration, thumbnailUri })), locationName: locationName.trim() || null, latitude, longitude })
          .then(() => {
            if (draftSaveVersionRef.current === saveVersion) setDraftStatus('saved');
          })
          .catch((error) => {
            void recordAppError('compose.auto-save-draft', error);
            if (draftSaveVersionRef.current === saveVersion) setDraftStatus('error');
            showToast('草稿自动保存失败');
          });
      } else if (activeDraftIdRef.current) {
        draftSaveVersionRef.current += 1;
        void deleteDraft(db, activeDraftIdRef.current).then((uris) => uris.forEach(deleteJournalImage)).catch(() => showToast('草稿清理失败'));
        activeDraftIdRef.current = null;
        setActiveDraftId(null);
        setDraftStatus('idle');
      } else {
        draftSaveVersionRef.current += 1;
        setDraftStatus('idle');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [activeDraftId, content, db, images, isEditing, latitude, loaded, locationName, longitude, mood, occurredAt, saving, tags, weather]);

  async function fillCurrentLocation() {
    if (locating) return;
    const requestId = ++locationRequestRef.current;
    const startedAt = Date.now();
    setLocating(true);
    setLocationStatus('正在查找可用位置…');

    const formatElapsed = () => {
      const elapsed = Date.now() - startedAt;
      return elapsed < 1000 ? `${elapsed} 毫秒` : `${(elapsed / 1000).toFixed(1)} 秒`;
    };

    const resolveAddress = async (position: Location.LocationObject, source: string) => {
      const addressRequest = ++addressRequestRef.current;
      const { latitude: nextLatitude, longitude: nextLongitude, accuracy } = position.coords;
      if (requestId !== locationRequestRef.current) return;
      setLocationStatus(`${source}${accuracy != null ? ` · 约 ±${Math.max(1, Math.round(accuracy))} 米` : ''} · 地址解析中…`);
      try {
        const systemAddressPromise = Location.reverseGeocodeAsync({ latitude: nextLatitude, longitude: nextLongitude });
        const gaodeResult = Platform.OS === 'android' ? await Promise.race([
          reGeocode({ location: wgs84ToGcj02({ latitude: nextLatitude, longitude: nextLongitude }), radius: 200 }),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('gaode-address-timeout')), 4000);
          }),
        ]).catch(() => null) : null;
        const nearbyPoi = gaodeResult ? rankNearbyPois(gaodeResult.pois)[0] : null;
        const addresses = nearbyPoi ? [] : await Promise.race([
          systemAddressPromise,
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('address-timeout')), 6000);
          }),
        ]);
        if (requestId !== locationRequestRef.current || addressRequest !== addressRequestRef.current) return;
        const nextLocationName = nearbyPoi?.name || formatLocationName(addresses[0]);
        if (nextLocationName) {
          const systemAddress = addresses[0]?.formattedAddress?.trim();
          setLocationAddress(gaodeResult?.formattedAddress?.trim() || systemAddress || nearbyPoi?.address?.trim() || '');
          setLocationName(nextLocationName);
          setLocationStatus(`${source}${accuracy != null ? ` · 约 ±${Math.max(1, Math.round(accuracy))} 米` : ''} · ${formatElapsed()}`);
        } else {
          setLocationStatus(`${source} · 坐标已保存，未查询到地址`);
        }
      } catch {
        if (requestId === locationRequestRef.current && addressRequest === addressRequestRef.current) {
          setLocationStatus(`${source} · 坐标已保存，地址解析暂不可用`);
        }
      }
    };

    const applyPosition = (position: Location.LocationObject, source: string) => {
      if (requestId !== locationRequestRef.current) return;
      const { latitude: nextLatitude, longitude: nextLongitude, accuracy } = position.coords;
      setLatitude(nextLatitude);
      setLongitude(nextLongitude);
      setLocationCoordinateChanged(true);
      setLocationAccuracy(accuracy);
      setLocationAddress('');
      setLocationName(`${nextLatitude.toFixed(5)}, ${nextLongitude.toFixed(5)}`);
      setLocationStatus(`${source}${accuracy != null ? ` · 约 ±${Math.max(1, Math.round(accuracy))} 米` : ''} · ${formatElapsed()}`);
      setLocating(false);
      void resolveAddress(position, source);
    };

    try {
      const provider = await Location.getProviderStatusAsync();
      if (!provider.locationServicesEnabled) {
        setLocationStatus('系统定位服务未开启');
        setLocationDialog({ title: '定位服务未开启', message: '请先打开手机定位服务，或直接手动填写地点。' });
        return;
      }
      let permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted && permission.canAskAgain) {
        permission = await Location.requestForegroundPermissionsAsync();
      }
      if (!permission.granted) {
        setLocationStatus('没有位置权限');
        setLocationDialog({
          title: '没有定位权限',
          message: permission.canAskAgain
            ? '请允许拾时在使用期间获取位置，或直接手动填写地点。'
            : '定位权限已被关闭，请前往系统设置允许拾时获取位置。',
          settings: !permission.canAskAgain,
        });
        return;
      }
      if (Platform.OS === 'android' && provider.networkAvailable === false) {
        try {
          await Location.enableNetworkProviderAsync();
        } catch {
          // The user can decline Google's high-accuracy prompt; GPS may still work.
        }
      }
      const freshPosition = Promise.race([
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          mayShowUserSettingsDialog: true,
        }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('coordinate-timeout')), 12_000);
        }),
      ]);
      const recentPosition = await Location.getLastKnownPositionAsync({
        maxAge: 2 * 60 * 60 * 1000,
        requiredAccuracy: 1000,
      });
      if (recentPosition) {
        applyPosition(recentPosition, '快速定位');
        void freshPosition.then((position) => {
          if (requestId !== locationRequestRef.current) return;
          const recentAccuracy = recentPosition.coords.accuracy ?? Number.POSITIVE_INFINITY;
          const freshAccuracy = position.coords.accuracy ?? Number.POSITIVE_INFINITY;
          if (freshAccuracy < recentAccuracy * 0.8) applyPosition(position, '精准定位');
        }).catch(() => {
          // A cached coordinate is already usable; a failed refinement is non-blocking.
        });
      } else {
        applyPosition(await freshPosition, '精准定位');
      }
    } catch (error) {
      if (requestId !== locationRequestRef.current) return;
      const timedOut = error instanceof Error && error.message === 'coordinate-timeout';
      setLocationDialog({
        title: timedOut ? '定位超时' : '无法获取坐标',
        message: timedOut
          ? '12 秒内没有收到系统坐标，也没有可用的最近坐标。请打开 Wi-Fi 或移动网络后重试，也可以直接填写地点。'
          : '系统定位暂时没有返回坐标。请检查拾时的位置权限后重试，或直接填写地点。',
        settings: true,
      });
      setLocationStatus(timedOut ? '定位超时，可尝试地图选点' : '暂时无法获取坐标');
    }
    finally {
      if (requestId === locationRequestRef.current) setLocating(false);
    }
  }

  async function applyTime() {
    const parsed = parseLocalDateTime(timeValue);
    if (!parsed) { await showAppDialog({ title: '时间格式不正确', message: '请使用 YYYY-MM-DD HH:mm，例如 2026-07-19 14:36。' }); return; }
    setOccurredAt(parsed); setTimeChanged(true); setEditingTime(false);
  }

  async function addImages(assets: ImagePicker.ImagePickerAsset[]) {
    try {
      const persisted = await Promise.all(assets.slice(0, 9 - images.length).map(async (asset) => {
        const mediaType = getPickerMediaType(asset);
        const uri = await persistJournalImage(asset.uri, asset.fileName);
        await saveMediaMetadata(db, uri, pickedMediaMetadata(asset));
        const thumbnailUri = mediaType === 'video' ? await createPersistentVideoThumbnail(uri) : await createPersistentImageThumbnail(uri);
        return { id: 'draft-image', uri, width: asset.width, height: asset.height, draftOwned: true,
          mediaType, pairedVideoUri: null, duration: asset.duration ?? null, thumbnailUri };
      }));
      setImages((current) => [...current, ...persisted.slice(0, 9 - current.length)]);
    } catch { await showAppDialog({ title: '图片添加失败', message: '图片没有保存，请稍后重试。' }); }
  }

  function reorderImage(from: number, to: number) {
    if (to < 0 || to >= images.length) return;
    setImages((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function chooseFromLibrary() {
    try {
      const remaining = 9 - images.length;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: remaining, ...journalPickerOptions(preferences.imageSaveQuality),
      });
      if (result.canceled) return;
      const qualityPrepared = await prepareImagesForStorage(result.assets, preferences.imageSaveQuality, (message) => setToast(message ?? ''));
      const prepared = await preparePickedMedia(qualityPrepared, (message) => setToast(message ?? ''));
      if (!prepared) return;
      setToast(pickedMediaSizeLabel(prepared, preferences.imageSaveQuality));
      await addImages(prepared);
    } catch {
      setToast('');
      await showAppDialog({ title: '无法添加媒体', message: '图片或视频处理失败，可能是文件格式暂不支持或文件已损坏。请换一个文件后重试。' });
    }
  }

  async function openCamera() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { await showAppDialog({ title: '无法使用相机', message: '请在系统设置中允许拾时使用相机。' }); return; }
    try {
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], videoMaxDuration: 60, ...journalPickerOptions(preferences.imageSaveQuality) });
      if (result.canceled) return;
      const qualityPrepared = await prepareImagesForStorage(result.assets, preferences.imageSaveQuality, (message) => setToast(message ?? ''));
      const prepared = await preparePickedMedia(qualityPrepared, (message) => setToast(message ?? ''));
      if (!prepared) return;
      setToast(pickedMediaSizeLabel(prepared, preferences.imageSaveQuality));
      await addImages(prepared);
    } catch {
      setToast('');
      await showAppDialog({ title: '无法添加媒体', message: '拍摄的媒体处理失败，请重新拍摄后再试。' });
    }
  }

  async function openImageMenu() {
    if (images.length >= 9) { await showAppDialog({ title: '最多添加 9 张图片' }); return; }
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
      let privateLatitude = latitude;
      let privateLongitude = longitude;
      if ((!id || locationCoordinateChanged) && latitude != null && longitude != null) {
        let choice: CoordinatePrivacyChoice = 'precise';
        if (preferences.locationPrivacyMode === 'ask') {
          choice = (await showAppDialog({
            title: '怎样保存这个地点？',
            message: '地点名称会保留，你可以选择坐标精度。',
            actions: [
              { label: '只存名称', value: 'nameOnly' },
              { label: '约 1 公里', value: 'approximate' },
              { label: '精确坐标', value: 'precise', tone: 'primary' },
            ],
          }) ?? 'nameOnly') as CoordinatePrivacyChoice;
        }
        ({ latitude: privateLatitude, longitude: privateLongitude } = applyLocationPrivacy(
          latitude, longitude, preferences.locationPrivacyMode, choice,
        ));
      }
      const savedImages = await Promise.all(images.map(async (image) => {
        if (image.id) return image;
        const uri = await persistJournalImage(image.uri, image.fileName);
        newlyPersisted.push(uri);
        return { ...image, uri };
      }));
      let entryId = id;
      let removedUris: string[] = [];
      const willLightNewPlace = !id && privateLatitude != null && privateLongitude != null
        ? await isNewFootprintLocation(db, locationName, privateLatitude, privateLongitude)
        : false;
      if (id) {
        // Editing text must never move an older entry to today. Only an explicitly
        // confirmed time change is allowed to replace the original occurrence time.
        removedUris = await updateEntryWithDetails(
          db, id, { content, occurredAt: timeChanged ? occurredAt : originalOccurredAt, mood, weather, locationName, latitude: privateLatitude, longitude: privateLongitude }, savedImages, tags,
        );
      } else {
        entryId = await createEntryWithDetails(db, { content, occurredAt, mood, weather, locationName, latitude: privateLatitude, longitude: privateLongitude }, savedImages, tags);
        if (activeDraftIdRef.current) await deleteDraft(db, activeDraftIdRef.current, true);
      }
      if (!entryId) throw new Error('Missing entry id');
      if (locationName.trim() && privateLatitude != null && privateLongitude != null) {
        if (locationAddress.trim()) {
          await saveLocationDetail(db, locationName, {
            address: locationAddress, latitude: privateLatitude, longitude: privateLongitude,
          });
        }
      }
      removedUris.forEach(deleteJournalImage);
      if (id) leaveComposer();
      else router.replace({ pathname: '/entry/[id]', params: { id: entryId, saved: '1', ...(willLightNewPlace ? { lit: locationName.trim() } : {}) } });
    } catch (error) {
      void recordAppError('compose.save-entry', error);
      newlyPersisted.forEach(deleteJournalImage);
      await showAppDialog({ title: '保存失败', message: '这次内容还没有完整保存，请稍后重试。' }); setSaving(false);
    }
  }

  async function persistCurrentDraft(silent = false) {
    if (isEditing || !(content.trim() || images.length || tags.length || mood || weather || locationName.trim())) return;
    const nextId = activeDraftIdRef.current ?? createDraftId();
    if (!activeDraftIdRef.current) { activeDraftIdRef.current = nextId; setActiveDraftId(nextId); }
    try {
      const saveVersion = ++draftSaveVersionRef.current;
      setDraftStatus('saving');
      await saveDraft(db, { id: nextId, content, occurredAt, updatedAt: new Date().toISOString(), tags, mood, weather, images: images.map(({ uri, width, height, mediaType, pairedVideoUri, duration, thumbnailUri }) => ({ uri, width, height, mediaType, pairedVideoUri, duration, thumbnailUri })), locationName: locationName.trim() || null, latitude, longitude });
      if (draftSaveVersionRef.current === saveVersion) setDraftStatus('saved');
    } catch (error) {
      void recordAppError('compose.save-draft-on-exit', error);
      setDraftStatus('error');
      if (!silent) await showAppDialog({ title: '草稿保存失败', message: '当前内容暂时无法写入草稿箱，请返回后再次确认。' });
      throw new Error('draft-save-failed');
    }
  }

  const persistDraftOnBackground = useEffectEvent(() => persistCurrentDraft(true));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const wasActive = appStateRef.current === 'active';
      appStateRef.current = state;
      if (wasActive && state !== 'active') void persistDraftOnBackground().catch(() => undefined);
    });
    return () => subscription.remove();
  }, []);

  async function cancel() {
    const hasChanges = content !== originalContent || occurredAt !== originalOccurredAt || mood !== originalMood || weather !== originalWeather || locationName !== originalLocationName || JSON.stringify(images.map((image) => image.uri)) !== JSON.stringify(originalImageUris) || JSON.stringify(tags) !== JSON.stringify(originalTags);
    if (isEditing && hasChanges) setExitConfirmationVisible(true);
    else {
      try { await persistCurrentDraft(); leaveComposer(); }
      catch { /* Keep the composer open so the user can retry. */ }
    }
  }

  const handleHardwareBack = useEffectEvent(() => {
    if (exitConfirmationVisible) setExitConfirmationVisible(false);
    else void cancel();
  });

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleHardwareBack();
      return true;
    });
    return () => subscription.remove();
  }, []);

  return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="取消编辑" onPress={() => void cancel()} hitSlop={12}><Text style={[styles.headerAction, { color: readingTheme.secondary }]}>取消</Text></Pressable>
        <Text style={[styles.title, { color: readingTheme.text }]}>{isEditing ? '编辑' : quickMode ? '快速记录' : '记录此刻'}</Text>
        <Pressable disabled={!content.trim() || saving} onPress={() => void save()} style={[styles.save, (!content.trim() || saving) && styles.saveDisabled]}><Text style={styles.saveText}>{saving ? '保存中' : '保存'}</Text></Pressable>
      </View>
      {toast ? <View pointerEvents="none" style={styles.toast}><Text style={styles.toastText}>{toast}</Text></View> : null}

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={[styles.editorTools, quickMode && styles.quickHidden]}>{editingTime ? <View style={styles.timeEditor}>
          <TextInput autoFocus value={timeValue} onChangeText={setTimeValue} placeholder="YYYY-MM-DD HH:mm" placeholderTextColor={readingTheme.secondary} style={[styles.timeInput, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} />
          <Pressable onPress={applyTime}><Text style={styles.apply}>确定</Text></Pressable>
        </View> : <View style={styles.composeQuickTools}><Pressable onPress={() => setEditingTime(true)} style={[styles.timeChip, { backgroundColor: readingTheme.surface }]}><Text style={styles.timeChipText}>发生于　{formatShortDateTime(occurredAt)}　›</Text></Pressable>{!isEditing ? <Pressable accessibilityLabel="选择日记模板" onPress={() => setTemplatePickerVisible(true)} style={[styles.templateButton, { backgroundColor: readingTheme.surface }]}><Text style={styles.templateButtonText}>模板</Text></Pressable> : null}</View>}
          <View style={styles.historyActions}>
            <Pressable accessibilityLabel="撤销正文修改" disabled={!canUndo} hitSlop={8} onPress={undoContent} style={[styles.historyButton, { backgroundColor: readingTheme.surface }, !canUndo && styles.historyButtonDisabled]}><SymbolView name={{ ios: 'arrow.uturn.backward', android: 'undo', web: 'undo' }} size={16} tintColor={colors.primary} /></Pressable>
            <Pressable accessibilityLabel="恢复正文修改" disabled={!canRedo} hitSlop={8} onPress={redoContent} style={[styles.historyButton, { backgroundColor: readingTheme.surface }, !canRedo && styles.historyButtonDisabled]}><SymbolView name={{ ios: 'arrow.uturn.forward', android: 'redo', web: 'redo' }} size={16} tintColor={colors.primary} /></Pressable>
          </View>
        </View>
        <TextInput ref={inputRef} multiline maxLength={10000} value={content} onChangeText={changeContent} placeholder="写下现在发生的事……" placeholderTextColor={readingTheme.secondary} textAlignVertical="top" style={[styles.editor, { color: readingBodyStyle.color, fontFamily: readingFontFamily, fontSize: 16 * fontScale, lineHeight: 26 * fontScale * readingBodyStyle.lineHeightMultiplier, letterSpacing: readingBodyStyle.letterSpacing }]} />
        {quickMode ? <Pressable onPress={() => setQuickMode(false)} style={[styles.expandQuick, { backgroundColor: readingTheme.surface }]}><Text style={styles.expandQuickText}>添加图片、地点或其他信息</Text></Pressable> : null}
        <View style={[styles.imageRow, quickMode && styles.quickHidden]}>
          {images.map((image, index) => <View key={image.uri} style={styles.imageItem}>
            <DraggableMediaItem accessibilityLabel={`第 ${index + 1} 个媒体`} columns={4} count={images.length} index={index} itemStride={72} onMove={reorderImage} verticalStride={72}>
              <MediaThumbnail media={{ uri: image.uri, mediaType: image.mediaType ?? 'image', pairedVideoUri: image.pairedVideoUri ?? null, duration: image.duration ?? null, thumbnailUri: image.thumbnailUri ?? null }} allowRuntimeVideoPoster style={styles.imagePreview} />
            </DraggableMediaItem>
            <Pressable accessibilityLabel="移除媒体" onPress={() => { if (image.draftOwned) { deleteJournalImage(image.uri); if (image.pairedVideoUri) deleteJournalImage(image.pairedVideoUri); if (image.thumbnailUri) deleteJournalImage(image.thumbnailUri); } setImages((current) => current.filter((_, itemIndex) => itemIndex !== index)); }} style={styles.removeImage}><Text style={styles.removeImageText}>×</Text></Pressable>
          </View>)}
          {images.length < 9 ? <Pressable accessibilityLabel="添加图片或视频" onPress={openImageMenu} style={[styles.addImage, { borderColor: readingTheme.border }]}><Text style={styles.addImageIcon}>＋</Text></Pressable> : null}
        </View>
        <View style={[styles.metaPanel, quickMode && styles.quickHidden]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.metaToolbarScroll} contentContainerStyle={styles.metaToolbar}>
            <Pressable accessibilityState={{ expanded: activeMeta === 'mood' }} onPress={() => setActiveMeta((value) => value === 'mood' ? null : 'mood')} style={[styles.metaButton, { backgroundColor: readingTheme.surface }, activeMeta === 'mood' && styles.metaButtonActive]}><Text style={[styles.metaButtonText, activeMeta === 'mood' && styles.metaButtonTextActive]}>{mood ? `${MOOD_ICONS[mood]} ${mood}` : '＋ 心情'}</Text></Pressable>
            <Pressable accessibilityState={{ expanded: activeMeta === 'weather' }} onPress={() => setActiveMeta((value) => value === 'weather' ? null : 'weather')} style={[styles.metaButton, { backgroundColor: readingTheme.surface }, activeMeta === 'weather' && styles.metaButtonActive]}><Text style={[styles.metaButtonText, activeMeta === 'weather' && styles.metaButtonTextActive]}>{weather ? `${WEATHER_ICONS[weather]} ${weather}` : '＋ 天气'}</Text></Pressable>
            <Pressable accessibilityState={{ expanded: activeMeta === 'location' }} onPress={() => setActiveMeta((value) => value === 'location' ? null : 'location')} style={[styles.metaButton, { backgroundColor: readingTheme.surface }, activeMeta === 'location' && styles.metaButtonActive]}><Text numberOfLines={1} style={[styles.metaButtonText, styles.locationMetaText, activeMeta === 'location' && styles.metaButtonTextActive]}>{locationName ? `⌖ ${locationName}` : '＋ 地点'}</Text></Pressable>
            <Pressable accessibilityState={{ expanded: activeMeta === 'tags' }} onPress={() => setActiveMeta((value) => value === 'tags' ? null : 'tags')} style={[styles.metaButton, { backgroundColor: readingTheme.surface }, activeMeta === 'tags' && styles.metaButtonActive]}><Text style={[styles.metaButtonText, activeMeta === 'tags' && styles.metaButtonTextActive]}>{tags.length ? `# ${tags.length} 个标签` : '＋ 标签'}</Text></Pressable>
          </ScrollView>
        {activeMeta === 'mood' ? <View style={[styles.metaEditor, { backgroundColor: readingTheme.background }]}><ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.metaChoiceScroll} contentContainerStyle={styles.moods}>
          {MOODS.map((item) => <Pressable accessibilityLabel={`心情：${item}`} key={item} onPress={() => setMood((current) => current === item ? null : item)} style={[styles.moodChip, { backgroundColor: readingTheme.surface }, mood === item && styles.moodChipActive]}><Text style={[styles.moodText, { color: readingTheme.secondary }, mood === item && styles.moodTextActive]}>{MOOD_ICONS[item]} {item}</Text></Pressable>)}
        </ScrollView></View> : null}
        {activeMeta === 'weather' ? <View style={[styles.metaEditor, { backgroundColor: readingTheme.background }]}><ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.metaChoiceScroll} contentContainerStyle={styles.moods}>
          {WEATHERS.map((item) => <Pressable accessibilityLabel={`天气：${item}`} key={item} onPress={() => setWeather((current) => current === item ? null : item)} style={[styles.moodChip, { backgroundColor: readingTheme.surface }, weather === item && styles.moodChipActive]}><Text style={[styles.moodText, { color: readingTheme.secondary }, weather === item && styles.moodTextActive]}>{WEATHER_ICONS[item]} {item}</Text></Pressable>)}
        </ScrollView></View> : null}
        {activeMeta === 'location' ? <View style={[styles.metaEditor, { backgroundColor: readingTheme.background }]}><Text style={[styles.metaEditorLabel, { color: readingTheme.secondary }]}>地点显示名称</Text><View style={styles.locationRow}><TextInput maxLength={100} value={locationName} onChangeText={(value) => { locationRequestRef.current += 1; addressRequestRef.current += 1; setLocationName(value); setLocationStatus(''); setLocating(false); }} placeholder="例如：学校、家、咖啡店" placeholderTextColor={readingTheme.secondary} style={[styles.locationInput, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} /><Pressable accessibilityLabel="使用当前位置" disabled={locating} onPress={() => void fillCurrentLocation()} style={[styles.locationButton, { backgroundColor: readingTheme.surface }]}><Text style={styles.locationButtonText}>{locating ? '获取坐标…' : '⌖ 自动定位'}</Text></Pressable></View><View style={styles.locationTools}><Pressable onPress={() => { locationRequestRef.current += 1; addressRequestRef.current += 1; setLocating(false); setLocationPickerVisible(true); }} style={[styles.locationTool, { backgroundColor: readingTheme.surface }]}><Text style={styles.locationButtonText}>在地图上选择 / 搜索</Text></Pressable>{locationStatus ? <Text numberOfLines={2} style={[styles.locationCoordinate, { color: readingTheme.secondary }]}>{locationStatus}</Text> : latitude != null && longitude != null ? <Text numberOfLines={1} style={[styles.locationCoordinate, { color: readingTheme.secondary }]}>{latitude.toFixed(5)}, {longitude.toFixed(5)}{locationAccuracy != null ? ` · 约 ±${Math.round(locationAccuracy)} 米` : ''}</Text> : <Text style={[styles.locationCoordinate, { color: readingTheme.secondary }]}>还没有坐标，地点不会出现在足迹地图</Text>}</View>{suggestions.locations.filter((item) => !locationName.trim() || item.toLocaleLowerCase().includes(locationName.trim().toLocaleLowerCase())).slice(0, 4).length ? <View style={styles.suggestionArea}><Text style={[styles.suggestionLabel, { color: readingTheme.secondary }]}>常用地点</Text><View style={styles.suggestionRow}>{suggestions.locations.filter((item) => !locationName.trim() || item.toLocaleLowerCase().includes(locationName.trim().toLocaleLowerCase())).slice(0, 4).map((item) => <Pressable key={item} onPress={() => { locationRequestRef.current += 1; addressRequestRef.current += 1; setLocationName(item); setLocationAddress(''); setLatitude(null); setLongitude(null); setLocationAccuracy(null); setLocationStatus(''); }} style={[styles.suggestionChip, { backgroundColor: readingTheme.surface }]}><Text numberOfLines={1} style={styles.suggestionText}>⌖ {item}</Text></Pressable>)}</View></View> : null}</View> : null}
        {activeMeta === 'tags' ? <View style={[styles.metaEditor, styles.tagEditor, { backgroundColor: readingTheme.background }]}>
          {tags.length ? <View style={styles.selectedTagRow}>{tags.map((tag) => <Pressable accessibilityLabel={`移除标签 ${tag}`} key={tag} onPress={() => setTags((current) => current.filter((item) => item !== tag))} style={[styles.tagChip, { backgroundColor: readingTheme.surface }]}><Text style={styles.tagChipText}>#{tag}　×</Text></Pressable>)}</View> : null}
          {tags.length < 5 ? <View style={[styles.tagInputRow, { backgroundColor: readingTheme.surface }]}><TextInput value={tagValue} onChangeText={changeTagValue} onBlur={() => addTag()} onSubmitEditing={() => addTag()} returnKeyType="done" blurOnSubmit placeholder="输入标签名称" placeholderTextColor={readingTheme.secondary} style={[styles.tagInput, { color: readingTheme.text }]} />{tagValue.trim() ? <Pressable accessibilityLabel="添加标签" hitSlop={6} onPress={() => addTag()} style={styles.tagAddButton}><Text style={styles.tagAddText}>添加</Text></Pressable> : null}</View> : null}
          {tags.length < 5 && suggestions.tags.filter((item) => !tags.includes(item) && (!tagValue.trim() || item.toLocaleLowerCase().includes(tagValue.trim().toLocaleLowerCase()))).slice(0, 4).length ? <View style={styles.suggestionArea}><Text style={[styles.suggestionLabel, { color: readingTheme.secondary }]}>常用标签</Text><View style={styles.suggestionRow}>{suggestions.tags.filter((item) => !tags.includes(item) && (!tagValue.trim() || item.toLocaleLowerCase().includes(tagValue.trim().toLocaleLowerCase()))).slice(0, 4).map((item) => <Pressable key={item} onPress={() => addTag(item)} style={[styles.suggestionChip, { backgroundColor: readingTheme.surface }]}><Text style={styles.suggestionText}>#{item}</Text></Pressable>)}</View></View> : null}
        </View> : null}
        </View>
        <View style={styles.editorMeta}>{!isEditing && draftStatus !== 'idle'
          ? <Text style={[styles.draft, { color: draftStatus === 'error' ? colors.danger : readingTheme.secondary }]}>
            {draftStatus === 'saving' ? '正在保存草稿…' : draftStatus === 'saved' ? '草稿已保存' : '草稿保存失败，请稍后重试'}
          </Text>
          : <View />}<Text style={[styles.counter, { color: readingTheme.secondary }]}>{content.length}/10000</Text></View>
      </ScrollView>
    </KeyboardAvoidingView>
    <AppDialog visible={imageMenuVisible} title="添加图片或视频" message="拍照会打开系统相机，可在相机中切换照片或视频模式。" onClose={() => setImageMenuVisible(false)} actions={[{ label: '相册', onPress: () => { setImageMenuVisible(false); void chooseFromLibrary(); } }, { label: '拍照', onPress: () => { setImageMenuVisible(false); void openCamera(); } }]} />
    <AppDialog visible={exitConfirmationVisible} title="退出编辑？" message="尚未保存的修改会丢失。" onClose={() => setExitConfirmationVisible(false)} actions={[{ label: '继续编辑', onPress: () => setExitConfirmationVisible(false) }, { label: '退出', tone: 'danger', onPress: () => { setExitConfirmationVisible(false); images.filter((image) => image.draftOwned).forEach((image) => { deleteJournalImage(image.uri); if (image.pairedVideoUri) deleteJournalImage(image.pairedVideoUri); }); leaveComposer(); } }]} />
    <AppDialog visible={Boolean(locationDialog)} title={locationDialog?.title ?? ''} message={locationDialog?.message} onClose={() => setLocationDialog(null)} actions={locationDialog?.settings ? [{ label: '稍后处理', onPress: () => setLocationDialog(null) }, { label: '打开设置', tone: 'primary', onPress: () => { setLocationDialog(null); void Linking.openSettings(); } }] : [{ label: '知道了', tone: 'primary', onPress: () => setLocationDialog(null) }]} />
    {locationPickerVisible ? <LocationPickerModal visible name={locationName} latitude={latitude} longitude={longitude} accuracy={locationAccuracy} onClose={() => setLocationPickerVisible(false)} onApply={(value) => { setLocationName(value.name); setLocationAddress(value.address); setLatitude(value.latitude); setLongitude(value.longitude); setLocationAccuracy(null); setLocationCoordinateChanged(true); setLocationPickerVisible(false); }} /> : null}
    <Modal visible={templatePickerVisible} transparent animationType="fade" onRequestClose={() => setTemplatePickerVisible(false)}>
      <Pressable accessibilityRole="button" accessibilityLabel="关闭模板选择" onPress={() => setTemplatePickerVisible(false)} style={styles.templateOverlay}>
        <Pressable onPress={(event) => event.stopPropagation()} style={[styles.templateCard, { backgroundColor: readingTheme.background }]}>
          <Text style={[styles.templateTitle, { color: readingTheme.text }]}>选择一个写作模板</Text>
          <Text style={[styles.templateHint, { color: readingTheme.secondary }]}>{content.trim() ? '模板会追加在已有正文后，不会覆盖现在的内容。' : '选好后仍可以自由修改所有文字。'}</Text>
          <ScrollView style={styles.templateList} showsVerticalScrollIndicator={false}>
            {journalTemplates.map((template) => <Pressable key={template.id} onPress={() => applyTemplate(template)} style={({ pressed }) => [styles.templateItem, { backgroundColor: readingTheme.surface }, pressed && styles.pressed]}>
              <View style={styles.templateLeaf}><Text style={styles.templateLeafText}>⌁</Text></View>
              <View style={styles.templateCopy}><Text style={[styles.templateItemTitle, { color: readingTheme.text }]}>{template.title}</Text><Text style={[styles.templateDescription, { color: readingTheme.secondary }]}>{template.description}</Text></View>
              <Text style={styles.templateArrow}>›</Text>
            </Pressable>)}
          </ScrollView>
          <Pressable onPress={() => setTemplatePickerVisible(false)} style={styles.templateCancel}><Text style={[styles.templateCancelText, { color: readingTheme.secondary }]}>取消</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, keyboard: { flex: 1 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  title: { color: colors.text, fontFamily: fonts.serif, fontSize: 16, lineHeight: 24, fontWeight: '600', includeFontPadding: false }, headerAction: { color: colors.textSecondary, fontSize: 13 },
  save: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.primary }, saveDisabled: { opacity: 0.35 }, saveText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  toast: { position: 'absolute', top: 62, left: spacing.xl, right: spacing.xl, zIndex: 20, alignItems: 'center' }, toastText: { overflow: 'hidden', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radii.pill, backgroundColor: '#31483EED', color: '#FFFFFF', fontSize: 11 },
  body: { flexGrow: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
  editorTools: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  composeQuickTools: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  timeChip: { minHeight: 28, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.sm, backgroundColor: colors.primarySoft }, timeChipText: { color: colors.primary, fontSize: 10 },
  templateButton: { minWidth: 42, minHeight: 28, alignItems: 'center', justifyContent: 'center', borderRadius: radii.sm },
  templateButtonText: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  timeEditor: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, timeInput: { flex: 1, height: 42, paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted, color: colors.text }, apply: { color: colors.primary, fontWeight: '700' },
  historyActions: { flexDirection: 'row', alignItems: 'center', gap: 10 }, historyButton: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill }, historyButtonDisabled: { opacity: 0.28 },
  metaPanel: { marginTop: spacing.sm },
  metaToolbarScroll: { flexGrow: 0 }, metaToolbar: { alignItems: 'center', gap: spacing.xs }, metaButton: { minHeight: 28, maxWidth: 170, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted }, metaButtonActive: { backgroundColor: colors.primarySoft }, metaButtonText: { color: colors.textSecondary, fontSize: 10, fontWeight: '600' }, metaButtonTextActive: { color: colors.primary }, locationMetaText: { maxWidth: 145 }, metaEditor: { marginTop: 4, paddingHorizontal: spacing.xs, paddingVertical: 4, borderRadius: radii.md, backgroundColor: colors.surface }, metaEditorLabel: { marginBottom: 6, fontSize: 11 }, metaChoiceScroll: { flexGrow: 0 }, moods: { alignItems: 'center', gap: spacing.xs },
  moodChip: { minHeight: 28, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted }, moodChipActive: { backgroundColor: colors.primary }, moodText: { color: colors.textSecondary, fontSize: 10 }, moodTextActive: { color: '#FFFFFF' },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, locationInput: { flex: 1, height: 40, paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted, color: colors.text, fontSize: 12 }, locationButton: { minHeight: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.md, backgroundColor: colors.primarySoft }, locationButtonText: { color: colors.primary, fontSize: 10, fontWeight: '600' },
  locationTools: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }, locationTool: { minHeight: 34, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.pill }, locationCoordinate: { flex: 1, minWidth: 0, fontSize: 11, lineHeight: 16 },
  tagEditor: { gap: spacing.xs }, selectedTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tagChip: { minHeight: 28, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.primarySoft }, tagChipText: { color: colors.primary, fontSize: 10 },
  tagInputRow: { width: '100%', height: 42, flexDirection: 'row', alignItems: 'center', borderRadius: radii.md },
  tagInput: { flex: 1, height: 44, paddingHorizontal: spacing.md, paddingVertical: 0, color: colors.text, fontSize: 12 },
  tagAddButton: { minHeight: 30, alignItems: 'center', justifyContent: 'center', marginRight: 4, paddingHorizontal: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.primary }, tagAddText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  suggestionArea: { marginTop: spacing.sm }, suggestionLabel: { marginBottom: 5, fontSize: 11 }, suggestionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }, suggestionChip: { minHeight: 30, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.pill }, suggestionText: { color: colors.primary, fontSize: 11 },
  imageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  imageItem: { position: 'relative' }, imagePreview: { width: 64, height: 64, borderRadius: radii.sm, backgroundColor: 'transparent' },
  sortingImage: { borderWidth: 2, borderColor: colors.primary, borderRadius: radii.sm },
  removeImage: { position: 'absolute', top: -8, right: -8, width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.overlay }, removeImageText: { color: '#FFFFFF', fontSize: 18, lineHeight: 21 },
  addImage: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radii.sm }, addImageIcon: { color: colors.primary, fontSize: 24, lineHeight: 28 },
  editor: { minHeight: 150, paddingTop: spacing.lg, color: colors.text, fontFamily: fonts.serif, fontSize: 16, lineHeight: 25, includeFontPadding: false }, editorMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md }, draft: { color: colors.textFaint, fontSize: 11 }, counter: { color: colors.textFaint, fontSize: 11 },
  quickHidden: { display: 'none' }, expandQuick: { alignSelf: 'flex-start', minHeight: 30, justifyContent: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radii.pill }, expandQuickText: { color: colors.primary, fontSize: 10, fontWeight: '700' },
  templateOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.overlay },
  templateCard: { width: '100%', maxWidth: 360, maxHeight: '82%', padding: spacing.xl, borderRadius: radii.lg },
  templateTitle: { fontFamily: fonts.serif, fontSize: 19, fontWeight: '600', textAlign: 'center' },
  templateHint: { marginTop: spacing.sm, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  templateList: { marginTop: spacing.lg },
  templateItem: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.md },
  templateLeaf: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: colors.primarySoft },
  templateLeafText: { color: colors.primary, fontSize: 19 },
  templateCopy: { flex: 1, paddingVertical: spacing.sm },
  templateItemTitle: { fontSize: 14, fontWeight: '700' },
  templateDescription: { marginTop: 2, fontSize: 11, lineHeight: 17 },
  templateArrow: { color: colors.primary, fontSize: 22 },
  templateCancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs },
  templateCancelText: { fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.62 },
});
