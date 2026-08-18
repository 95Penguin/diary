import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import PagerView from 'react-native-pager-view';

import { createFollowUpWithImages, deleteEntry, deleteFollowUp, getEntry, getFollowUpOrder, saveFollowUpOrder, saveMediaMetadata, setEntryFavorite, updateFollowUpWithImages } from '@/database/journal-repository';
import { EntryActionModal } from '@/components/entry-action-modal';
import type { Entry, FollowUp } from '@/domain/journal';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { formatFullDate, formatShortDateTime } from '@/utils/date';
import { deleteJournalImage, persistJournalImage } from '@/utils/image-storage';
import { useAppPreferences } from '@/preferences/app-preferences';
import { countJournalCharacters } from '@/utils/text';
import { AppDialog } from '@/components/app-dialog';
import { showAppDialog } from '@/components/app-dialog-host';
import { DraggableMediaItem } from '@/components/draggable-media-item';
import { MediaThumbnail, MediaViewer, type JournalMedia } from '@/components/media-view';
import { getPickerMediaType, preparePickedMedia } from '@/utils/picker-media';
import { createPersistentVideoThumbnail } from '@/utils/video-thumbnail-cache';
import { createPersistentImageThumbnail } from '@/utils/image-thumbnail-cache';
import { journalPickerOptions, pickedMediaMetadata, pickedMediaSizeLabel } from '@/utils/image-quality';
import { prepareImagesForStorage } from '@/utils/image-processing';

type PendingMedia = JournalMedia & { width: number; height: number; fileName?: string | null; pairedVideoFileName?: string | null; pickerMetadata?: ReturnType<typeof pickedMediaMetadata> };

export default function EntryDetailScreen() {
  const db = useSQLiteContext();
  const { preferences, fontScale, readingBodyStyle, readingFontFamily, readingTheme } = useAppPreferences();
  const { id, lit, saved, match, followUpId } = useLocalSearchParams<{ id: string; lit?: string; saved?: string; match?: string; followUpId?: string }>();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);
  const [followUp, setFollowUp] = useState('');
  const [followUpImages, setFollowUpImages] = useState<PendingMedia[]>([]);
  const [sending, setSending] = useState(false);
  const [editingFollowUp, setEditingFollowUp] = useState<FollowUp | null>(null);
  const [editFollowUpImages, setEditFollowUpImages] = useState<FollowUp['images']>([]);
  const [followUpAction, setFollowUpAction] = useState<FollowUp | null>(null);
  const [confirmingFollowUpDelete, setConfirmingFollowUpDelete] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [previewImages, setPreviewImages] = useState<JournalMedia[]>([]);
  const [previewChromeVisible, setPreviewChromeVisible] = useState(true);
  const [mediaMenuVisible, setMediaMenuVisible] = useState(false);
  const [entryMenuVisible, setEntryMenuVisible] = useState(false);
  const [followUpOrder, setFollowUpOrder] = useState<'asc' | 'desc'>('asc');
  const [savedVisible, setSavedVisible] = useState(saved === '1' && !lit);
  const [activeMatch, setActiveMatch] = useState(match ?? '');
  const detailScrollRef = useRef<ScrollView>(null);
  const didScrollToMatch = useRef(false);

  useEffect(() => {
    if (!savedVisible) return;
    router.setParams({ saved: '' });
    const timer = setTimeout(() => setSavedVisible(false), 1500);
    return () => clearTimeout(timer);
  }, [savedVisible]);
  const [compressionStatus, setCompressionStatus] = useState<string | null>(null);
  const [litLocation, setLitLocation] = useState(lit ?? '');

  useEffect(() => {
    if (!entry || !match) return;
    const timer = setTimeout(() => setActiveMatch(''), 3000);
    if (!followUpId && !didScrollToMatch.current) {
      didScrollToMatch.current = true;
      requestAnimationFrame(() => detailScrollRef.current?.scrollTo({ y: 0, animated: true }));
    }
    return () => clearTimeout(timer);
  }, [entry, followUpId, match]);

  const load = useCallback(async () => {
    if (!id) { setLoading(false); return; }
    try {
      const [nextEntry, order] = await Promise.all([getEntry(db, id), getFollowUpOrder(db)]);
      setEntry(nextEntry);
      setFollowUpOrder(order);
    }
    finally { setLoading(false); }
  }, [db, id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function leaveDetail() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  async function toggleFavorite() {
    if (!entry) return;
    const next = !entry.favoritedAt;
    setEntry({ ...entry, favoritedAt: next ? new Date().toISOString() : null });
    try { await setEntryFavorite(db, entry.id, next); }
    catch { await load(); await showAppDialog({ title: '操作失败', message: '收藏状态没有保存，请稍后重试。' }); }
  }

  async function addFollowUp() {
    if (!entry || (!followUp.trim() && !followUpImages.length) || sending) return;
    setSending(true);
    const persisted: string[] = [];
    try {
      const savedMedia = [];
      for (const image of followUpImages) {
        const uri = await persistJournalImage(image.uri, image.fileName);
        persisted.push(uri);
        if (image.pickerMetadata) await saveMediaMetadata(db, uri, image.pickerMetadata);
        let pairedVideoUri: string | null = null;
        if (image.pairedVideoUri) {
          pairedVideoUri = await persistJournalImage(image.pairedVideoUri, image.pairedVideoFileName);
          persisted.push(pairedVideoUri);
        }
        const thumbnailUri = image.mediaType === 'video' ? await createPersistentVideoThumbnail(uri) : await createPersistentImageThumbnail(uri);
        if (thumbnailUri) persisted.push(thumbnailUri);
        savedMedia.push({ ...image, uri, pairedVideoUri, thumbnailUri });
      }
      await createFollowUpWithImages(db, entry.id, followUp, savedMedia);
      setFollowUp(''); setFollowUpImages([]); Keyboard.dismiss();
    }
    catch {
      persisted.forEach(deleteJournalImage);
      await showAppDialog({ title: '添加失败', message: '后续没有保存，请稍后重试。' });
      setSending(false);
      return;
    }
    try { await load(); }
    catch { await showAppDialog({ title: '已保存', message: '后续已经保存，但页面暂时没有刷新出来。重新进入这一刻即可看到。' }); }
    finally { setSending(false); }
  }

  function appendFollowUpMedia(assets: ImagePicker.ImagePickerAsset[], remaining: number) {
    setFollowUpImages((current) => [
      ...current,
      ...assets.slice(0, remaining).map((asset) => ({
        uri: asset.uri, width: asset.width, height: asset.height, fileName: asset.fileName,
        mediaType: getPickerMediaType(asset),
        pairedVideoUri: null,
        pairedVideoFileName: null,
        duration: asset.duration ?? null,
        thumbnailUri: null,
        pickerMetadata: pickedMediaMetadata(asset),
      })),
    ]);
  }

  function reorderFollowUpImage(from: number, to: number) {
    if (to < 0 || to >= followUpImages.length) return;
    setFollowUpImages((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function pickFollowUpImages() {
    const remaining = 5 - followUpImages.length;
    if (remaining <= 0) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        ...journalPickerOptions(preferences.imageSaveQuality),
      });
      if (result.canceled) return;
      const qualityPrepared = await prepareImagesForStorage(result.assets, preferences.imageSaveQuality, setCompressionStatus);
      const prepared = await preparePickedMedia(qualityPrepared, setCompressionStatus);
      if (!prepared) return;
      setCompressionStatus(pickedMediaSizeLabel(prepared, preferences.imageSaveQuality));
      appendFollowUpMedia(prepared, remaining);
    } catch {
      setCompressionStatus(null);
      await showAppDialog({ title: '无法添加媒体', message: '图片或视频处理失败，可能是文件格式暂不支持或文件已损坏。请换一个文件后重试。' });
    }
  }

  async function captureFollowUpMedia() {
    const remaining = 5 - followUpImages.length;
    if (remaining <= 0) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { await showAppDialog({ title: '无法使用相机', message: '请在系统设置中允许拾时使用相机。' }); return; }
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images', 'videos'],
        videoMaxDuration: 60,
        ...journalPickerOptions(preferences.imageSaveQuality),
      });
      if (result.canceled) return;
      const qualityPrepared = await prepareImagesForStorage(result.assets, preferences.imageSaveQuality, setCompressionStatus);
      const prepared = await preparePickedMedia(qualityPrepared, setCompressionStatus);
      if (!prepared) return;
      setCompressionStatus(pickedMediaSizeLabel(prepared, preferences.imageSaveQuality));
      appendFollowUpMedia(prepared, remaining);
    } catch {
      setCompressionStatus(null);
      await showAppDialog({ title: '无法添加媒体', message: '拍摄的媒体处理失败，请重新拍摄后再试。' });
    }
  }

  function openImagePreview(images: JournalMedia[], index: number) {
    setPreviewImages(images);
    setPreviewChromeVisible(true);
    setPreviewIndex(index);
  }

  async function toggleFollowUpOrder() {
    const next = followUpOrder === 'asc' ? 'desc' : 'asc';
    setFollowUpOrder(next);
    await saveFollowUpOrder(db, next);
  }

  function openEntryMenu() {
    if (!entry) return;
    setEntryMenuVisible(true);
  }

  function editEntry() {
    if (!entry) return;
    setEntryMenuVisible(false);
    router.push({ pathname: '/compose', params: { id: entry.id } });
  }

  async function deleteCurrentEntry() {
    if (!entry) return;
    try {
      const imageUris = await deleteEntry(db, entry.id);
      imageUris.forEach(deleteJournalImage);
      setEntryMenuVisible(false);
      router.dismissAll();
    }
    catch {
      setEntryMenuVisible(false);
      await showAppDialog({ title: '移入失败', message: '记录暂时无法移入回收站，请稍后重试。' });
    }
  }

  function openFollowUpMenu(item: FollowUp) {
    setFollowUpAction(item);
    setConfirmingFollowUpDelete(false);
  }

  async function saveFollowUpEdit() {
    if (!editingFollowUp || (!editValue.trim() && !editFollowUpImages.length)) return;
    let removedUris: string[];
    try {
      removedUris = await updateFollowUpWithImages(db, editingFollowUp.id, editValue, editFollowUpImages);
    } catch { await showAppDialog({ title: '保存失败', message: '这条后续没有保存，请稍后重试。' }); return; }
    removedUris.forEach(deleteJournalImage);
    setEditingFollowUp(null); setEditValue(''); setEditFollowUpImages([]);
    try { await load(); }
    catch { await showAppDialog({ title: '已保存', message: '修改已经保存，但页面暂时没有刷新出来。重新进入这一刻即可看到。' }); }
  }

  if (loading) return <SafeAreaView style={styles.safe}><View style={styles.missing}><Text style={styles.loadingText}>正在打开这一刻…</Text></View></SafeAreaView>;
  if (!entry) return <SafeAreaView style={styles.safe}><View style={styles.missing}><Text style={styles.missingTitle}>记录不存在</Text><Pressable onPress={leaveDetail}><Text style={styles.backLink}>返回时间轴</Text></Pressable></View></SafeAreaView>;

  return <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[styles.header, { borderBottomColor: readingTheme.border }]}><Pressable accessibilityLabel="返回" onPress={leaveDetail} hitSlop={12}><Text style={styles.back}>‹ 返回</Text></Pressable><Text style={[styles.headerTitle, { color: readingTheme.text }]}>这一刻</Text><View style={styles.headerActions}><Pressable accessibilityLabel={entry.favoritedAt ? '取消收藏' : '收藏'} onPress={() => void toggleFavorite()} hitSlop={12} style={styles.favoriteButton}><SymbolView name={{ ios: entry.favoritedAt ? 'bookmark.fill' : 'bookmark', android: entry.favoritedAt ? 'bookmark' : 'bookmark_border', web: entry.favoritedAt ? 'bookmark' : 'bookmark_border' }} size={19} tintColor={entry.favoritedAt ? colors.primary : readingTheme.secondary} /></Pressable><Pressable accessibilityLabel="记录操作" onPress={openEntryMenu} hitSlop={12}><Text style={[styles.menu, { color: readingTheme.secondary }]}>•••</Text></Pressable></View></View>
      {savedVisible ? <View accessibilityLiveRegion="polite" pointerEvents="none" style={styles.savedToast}><Text style={styles.savedToastText}>✓ 已保存</Text></View> : null}
      <ScrollView ref={detailScrollRef} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={styles.date}>{formatFullDate(entry.occurredAt)}</Text>
        <Text style={[styles.content, { color: readingBodyStyle.color, fontFamily: readingFontFamily, fontSize: 16 * fontScale, lineHeight: 26 * fontScale * readingBodyStyle.lineHeightMultiplier, letterSpacing: readingBodyStyle.letterSpacing }]}><MatchText text={entry.content} query={!followUpId ? activeMatch : ''} /></Text>
        {entry.images.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.imageStrip}>
          {entry.images.map((image, index) => <Pressable accessibilityLabel={`查看媒体 ${index + 1}`} key={image.id} onPress={() => openImagePreview(entry.images, index)}><MediaThumbnail media={image} allowRuntimeVideoPoster style={styles.detailImage} /></Pressable>)}
        </ScrollView> : null}
        {entry.mood || entry.weather || entry.locationName || entry.tags.length ? <View accessibilityLabel="记录信息" style={styles.metaSummary}>
          {entry.mood ? <Text style={[styles.metaItem, { backgroundColor: readingTheme.surface, color: readingTheme.secondary }]}>{entry.mood}</Text> : null}
          {entry.weather ? <Text style={[styles.metaItem, { backgroundColor: readingTheme.surface, color: readingTheme.secondary }]}>{entry.weather}</Text> : null}
          {entry.locationName ? <Text numberOfLines={1} style={[styles.metaItem, styles.locationItem, { backgroundColor: readingTheme.surface, color: readingTheme.secondary }]}>⌖ {entry.locationName}</Text> : null}
          {entry.tags.map((tag) => <Text key={tag} style={[styles.metaItem, { backgroundColor: readingTheme.surface, color: readingTheme.secondary }]}>#<MatchText text={tag} query={!followUpId ? activeMatch : ''} /></Text>)}
        </View> : null}
        <View style={styles.createdRow}>{entry.createdAt !== entry.occurredAt ? <Text style={[styles.created, { color: readingTheme.secondary }]}>记录于 {formatShortDateTime(entry.createdAt)}</Text> : <View />}<Text accessibilityLabel={`正文 ${countJournalCharacters(entry.content)} 字`} style={[styles.created, { color: readingTheme.secondary }]}>{countJournalCharacters(entry.content)} 字</Text></View>
        <View style={[styles.divider, { backgroundColor: readingTheme.border }]} />
        <View style={styles.followUpHeading}><Text style={[styles.followUpTitle, { color: readingTheme.text }]}>后续</Text><View style={styles.followUpHeadingRight}><Text style={[styles.count, { color: readingTheme.secondary }]}>{entry.followUps.length} 条</Text>{entry.followUps.length > 1 ? <Pressable hitSlop={8} onPress={() => void toggleFollowUpOrder()} style={[styles.orderButton, { backgroundColor: readingTheme.surface }]}><Text style={styles.orderText}>{followUpOrder === 'asc' ? '正序' : '倒序'}</Text><View style={styles.orderChevron} /></Pressable> : null}</View></View>
        {entry.followUps.length ? [...entry.followUps].sort((a, b) => followUpOrder === 'asc' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)).map((item) => <View key={item.id} onLayout={(event) => { if (item.id === followUpId && !didScrollToMatch.current) { didScrollToMatch.current = true; const y = event.nativeEvent.layout.y; requestAnimationFrame(() => detailScrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true })); } }} style={styles.followUpItem}>
          <View style={styles.rail}><View style={[styles.dot, { backgroundColor: readingTheme.background }]} /><View style={[styles.line, { backgroundColor: readingTheme.border }]} /></View>
          <View style={styles.followUpBody}>
            <View style={styles.followUpMeta}><Text style={[styles.followUpTime, { color: readingTheme.secondary }]}>{formatShortDateTime(item.createdAt)}</Text><Pressable accessibilityLabel="后续操作" hitSlop={10} onPress={() => openFollowUpMenu(item)}><Text style={[styles.followUpMenu, { color: readingTheme.secondary }]}>•••</Text></Pressable></View>
            <Text style={[styles.followUpText, { color: readingBodyStyle.color, fontFamily: readingFontFamily, fontSize: 14 * fontScale, lineHeight: 22 * fontScale * readingBodyStyle.lineHeightMultiplier, letterSpacing: readingBodyStyle.letterSpacing }]}><MatchText text={item.content} query={item.id === followUpId ? activeMatch : ''} /></Text>
            {item.images.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.followUpImageRow}>{item.images.map((image, index) => <Pressable key={image.id} onPress={() => openImagePreview(item.images, index)}><MediaThumbnail media={image} allowRuntimeVideoPoster style={styles.followUpImage} /></Pressable>)}</ScrollView> : null}
          </View>
        </View>) : <Text style={[styles.empty, { color: readingTheme.secondary }]}>后来发生了什么？可以随时回来补充。</Text>}
      </ScrollView>
      <View style={[styles.inputArea, { backgroundColor: readingTheme.background, borderTopColor: readingTheme.border }]}>
        {followUpImages.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pendingImages}>{followUpImages.map((image, index) => <View key={image.uri}>
          <DraggableMediaItem accessibilityLabel={`第 ${index + 1} 个后续媒体`} columns={followUpImages.length} count={followUpImages.length} index={index} itemStride={58} onMove={reorderFollowUpImage}><MediaThumbnail media={image} allowRuntimeVideoPoster style={styles.pendingImage} /></DraggableMediaItem>
          <Pressable accessibilityLabel="移除后续媒体" onPress={() => setFollowUpImages((current) => current.filter((_, itemIndex) => itemIndex !== index))} style={styles.pendingRemove}><Text style={styles.pendingRemoveText}>×</Text></Pressable>
        </View>)}</ScrollView> : null}
        {compressionStatus ? <Text style={[styles.compressionStatus, { color: readingTheme.secondary }]}>{compressionStatus}</Text> : null}
        <View style={styles.inputBar}><TextInput multiline maxLength={2000} value={followUp} onChangeText={setFollowUp} placeholder="写一条后续……" placeholderTextColor={readingTheme.secondary} textAlignVertical="top" style={[styles.input, { backgroundColor: readingTheme.surface, color: readingTheme.text, fontFamily: readingFontFamily }]} /><Pressable accessibilityLabel="添加后续图片或视频" disabled={followUpImages.length >= 5 || sending || Boolean(compressionStatus)} hitSlop={6} onPress={() => setMediaMenuVisible(true)} style={[styles.imagePickerButton, { backgroundColor: readingTheme.surface, borderColor: readingTheme.border }]}><Text style={styles.imagePickerText}>＋</Text></Pressable><Pressable accessibilityLabel="发送后续" disabled={(!followUp.trim() && !followUpImages.length) || sending} onPress={() => void addFollowUp()} style={styles.sendButton}><Text style={[styles.send, ((!followUp.trim() && !followUpImages.length) || sending) && styles.disabled]}>{sending ? '发送中' : '发送'}</Text></Pressable></View>
      </View>
      <Modal visible={Boolean(editingFollowUp)} transparent animationType="fade" onRequestClose={() => { setEditingFollowUp(null); setEditFollowUpImages([]); }}>
        <KeyboardAvoidingView style={styles.modalKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.modalOverlay}><View style={[styles.modalCard, { backgroundColor: readingTheme.background }]}>
          <Text style={[styles.modalTitle, { color: readingTheme.text }]}>编辑</Text>
          {editFollowUpImages.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.editMediaRow}>{editFollowUpImages.map((image, index) => <View key={image.id} style={styles.editMediaItem}><MediaThumbnail media={image} allowRuntimeVideoPoster style={styles.editMedia} /><Pressable accessibilityLabel={`删除第 ${index + 1} 个后续媒体`} hitSlop={8} onPress={() => setEditFollowUpImages((current) => current.filter((item) => item.id !== image.id))} style={styles.editMediaRemove}><Text style={styles.pendingRemoveText}>×</Text></Pressable></View>)}</ScrollView> : null}
          <TextInput autoFocus multiline maxLength={2000} value={editValue} onChangeText={setEditValue} textAlignVertical="top" style={[styles.modalInput, { backgroundColor: readingTheme.surface, color: readingTheme.text, fontFamily: readingFontFamily }]} />
          {!editValue.trim() && !editFollowUpImages.length ? <Text style={styles.editEmptyHint}>请保留文字或至少一个媒体；如需全部移除，可删除整条后续。</Text> : null}
          <View style={styles.modalActions}><Pressable onPress={() => { setEditingFollowUp(null); setEditFollowUpImages([]); }}><Text style={[styles.modalCancel, { color: readingTheme.secondary }]}>取消</Text></Pressable><Pressable disabled={!editValue.trim() && !editFollowUpImages.length} onPress={() => void saveFollowUpEdit()}><Text style={[styles.modalSave, (!editValue.trim() && !editFollowUpImages.length) && styles.disabled]}>保存</Text></Pressable></View>
        </View></View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={previewIndex !== null} transparent animationType="fade" onRequestClose={() => setPreviewIndex(null)}>
        <GestureHandlerRootView style={styles.previewOverlay}>
          {previewIndex !== null ? <PagerView
            initialPage={previewIndex}
            offscreenPageLimit={1}
            overdrag={false}
            style={styles.previewScroller}
            onPageSelected={(event) => setPreviewIndex(event.nativeEvent.position)}
          >
            {previewImages.map((media, index) => <View accessibilityLabel={`媒体 ${index + 1}，共 ${previewImages.length} 个`} collapsable={false} key={`${index}-${media.uri}`} style={styles.previewPage}>
              <MediaViewer media={media} onPress={() => setPreviewChromeVisible((visible) => !visible)} />
            </View>)}
          </PagerView> : null}
          {previewChromeVisible && previewIndex !== null && previewImages.length > 1 ? <Text style={styles.previewCount}>{previewIndex + 1} / {previewImages.length}</Text> : null}
          {previewChromeVisible ? <Pressable accessibilityLabel="关闭图片" onPress={() => setPreviewIndex(null)} hitSlop={12} style={styles.previewCloseButton}><Text style={styles.previewClose}>×</Text></Pressable> : null}
        </GestureHandlerRootView>
      </Modal>
      <EntryActionModal visible={entryMenuVisible} onClose={() => setEntryMenuVisible(false)} onEdit={editEntry} onDelete={deleteCurrentEntry} onHistory={() => { setEntryMenuVisible(false); router.push({ pathname: '/history/[id]', params: { id: entry.id } }); }} onShare={() => { setEntryMenuVisible(false); router.push(`/share-card?id=${encodeURIComponent(entry.id)}` as Href); }} />
      <AppDialog visible={Boolean(litLocation)} title="🍃 新地点已点亮" message={`你在“${litLocation}”留下了第一条足迹。`} onClose={() => setLitLocation('')} actions={[{ label: '继续记录', onPress: () => setLitLocation('') }, { label: '查看地图', tone: 'primary', onPress: () => { setLitLocation(''); router.push('/footprint-map' as Href); } }]} />
      <AppDialog visible={mediaMenuVisible} title="添加图片或视频" message="最多添加 5 个；拍照会打开系统相机，可切换照片或视频模式。" onClose={() => setMediaMenuVisible(false)} actions={[{ label: '相册', onPress: () => { setMediaMenuVisible(false); void pickFollowUpImages(); } }, { label: '拍照', onPress: () => { setMediaMenuVisible(false); void captureFollowUpMedia(); } }]} />
      <AppDialog visible={Boolean(followUpAction)} title={confirmingFollowUpDelete ? '删除这条后续？' : '后续操作'} message={confirmingFollowUpDelete ? '删除后将无法恢复。' : undefined} onClose={() => { setFollowUpAction(null); setConfirmingFollowUpDelete(false); }} actions={confirmingFollowUpDelete ? [{ label: '取消', onPress: () => setConfirmingFollowUpDelete(false) }, { label: '删除', tone: 'danger', onPress: async () => { if (!followUpAction) return; try { const images = await deleteFollowUp(db, followUpAction.id); images.forEach(deleteJournalImage); setFollowUpAction(null); setConfirmingFollowUpDelete(false); await load(); } catch { await showAppDialog({ title: '删除失败', message: '这条后续暂时无法删除，请稍后重试。' }); } } }] : [{ label: '编辑', tone: 'primary', onPress: () => { if (!followUpAction) return; setEditingFollowUp(followUpAction); setEditValue(followUpAction.content); setEditFollowUpImages(followUpAction.images); setFollowUpAction(null); } }, { label: '删除', tone: 'danger', onPress: () => setConfirmingFollowUpDelete(true) }]} />
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function MatchText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(`(${escaped})`, 'gi');
  return <>{text.split(matcher).map((part, index) => part.toLocaleLowerCase() === query.trim().toLocaleLowerCase() ? <Text key={`${part}-${index}`} style={styles.matchHighlight}>{part}</Text> : part)}</>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, flex: { flex: 1 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  savedToast: { position: 'absolute', top: 62, zIndex: 20, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.text }, savedToastText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  back: { color: colors.primary, fontSize: 13 }, headerTitle: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 24, fontWeight: '600', includeFontPadding: false }, headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg }, favoriteButton: { width: 28, height: 36, alignItems: 'center', justifyContent: 'center' }, menu: { color: colors.textSecondary, letterSpacing: 2 },
  scroll: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xl },
  date: { color: colors.primary, fontSize: 11, fontWeight: '700' }, content: { marginTop: spacing.md, color: colors.text, fontFamily: fonts.serif, fontSize: 17, lineHeight: 27, includeFontPadding: false }, matchHighlight: { color: colors.text, backgroundColor: colors.highlight, fontWeight: '700' }, metaSummary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, marginTop: spacing.md }, metaItem: { overflow: 'hidden', paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radii.pill, color: colors.textSecondary, fontSize: 10 }, locationItem: { maxWidth: '100%' }, createdRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  imageStrip: { gap: spacing.sm, paddingTop: spacing.md }, detailImage: { width: 112, height: 112, borderRadius: radii.md, backgroundColor: 'transparent' },
  created: { marginTop: spacing.md, color: colors.textFaint, fontSize: 10 }, divider: { height: StyleSheet.hairlineWidth, marginTop: spacing.md, marginBottom: spacing.sm, backgroundColor: colors.border },
  followUpHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }, followUpTitle: { fontFamily: fonts.serif, fontSize: 17, lineHeight: 26, fontWeight: '600', includeFontPadding: false }, followUpHeadingRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, count: { color: colors.textFaint, fontSize: 10 },
  orderButton: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted }, orderText: { color: colors.primary, fontSize: 10, lineHeight: 14 }, orderChevron: { width: 5, height: 5, marginTop: -2, borderRightWidth: 1.25, borderBottomWidth: 1.25, borderColor: colors.primary, transform: [{ rotate: '45deg' }] },
  followUpItem: { flexDirection: 'row', minHeight: 44 }, rail: { width: 20, alignItems: 'center' }, dot: { width: 8, height: 8, marginTop: 4, borderRadius: 4, borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.background }, line: { width: 1, flex: 1, marginVertical: 3, backgroundColor: colors.border },
  followUpBody: { flex: 1, paddingBottom: spacing.sm }, followUpMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, followUpTime: { color: colors.textFaint, fontSize: 10 }, followUpMenu: { minWidth: 28, color: colors.textSecondary, textAlign: 'right', letterSpacing: 1 }, followUpText: { marginTop: 1, color: colors.text, fontSize: 13, lineHeight: 20 }, followUpImageRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }, followUpImage: { width: 72, height: 72, borderRadius: radii.sm },
  empty: { color: colors.textFaint, textAlign: 'center', paddingVertical: spacing.xl, fontSize: 11 },
  inputArea: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, compressionStatus: { marginBottom: spacing.xs, fontSize: 10, textAlign: 'right' }, inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }, imagePickerButton: { width: 32, height: 32, marginBottom: 5, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: 16 }, imagePickerText: { color: colors.primary, fontSize: 18, lineHeight: 20, fontWeight: '400' }, pendingImages: { flexDirection: 'row', gap: spacing.sm, paddingTop: 5, paddingBottom: spacing.sm }, pendingImage: { width: 50, height: 50, borderRadius: radii.sm }, pendingSorting: { borderWidth: 2, borderColor: colors.primary, borderRadius: radii.sm }, pendingRemove: { position: 'absolute', top: -5, right: -5, width: 18, height: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: colors.overlay }, pendingRemoveText: { color: '#FFFFFF', fontSize: 14, lineHeight: 16 },
  input: { flex: 1, minHeight: 42, maxHeight: 104, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radii.md, backgroundColor: colors.surfaceMuted, color: colors.text, fontSize: 13, lineHeight: 20, includeFontPadding: false }, sendButton: { minHeight: 42, justifyContent: 'center', paddingBottom: 1 }, send: { color: colors.primary, fontSize: 12, fontWeight: '700' }, disabled: { opacity: 0.3 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center' }, loadingText: { color: colors.textFaint, fontSize: 12 }, missingTitle: { fontFamily: fonts.serif, fontSize: 18 }, backLink: { marginTop: spacing.lg, color: colors.primary },
  modalKeyboard: { flex: 1 }, modalOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.overlay }, modalCard: { width: '100%', padding: spacing.xl, borderRadius: radii.lg, backgroundColor: colors.surface }, modalTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' },
  editMediaRow: { gap: spacing.sm, paddingTop: spacing.lg, paddingHorizontal: 5 }, editMediaItem: { position: 'relative' }, editMedia: { width: 64, height: 64, borderRadius: radii.sm }, editMediaRemove: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.overlay }, editEmptyHint: { marginTop: spacing.sm, color: colors.danger, fontSize: 10, lineHeight: 15 },
  modalInput: { minHeight: 120, marginTop: spacing.lg, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted, color: colors.text, fontSize: 15, lineHeight: 23 }, modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xxl, marginTop: spacing.xl }, modalCancel: { color: colors.textSecondary }, modalSave: { color: colors.primary, fontWeight: '700' },
  previewOverlay: { flex: 1, backgroundColor: '#111111F2' }, previewScroller: { flex: 1 }, previewPage: { height: '100%', alignItems: 'center', justifyContent: 'center' }, previewImage: { width: '100%', height: '100%' }, previewCloseButton: { position: 'absolute', top: 48, right: 20, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, previewClose: { color: '#FFFFFF', fontSize: 34, lineHeight: 38 }, previewCount: { position: 'absolute', bottom: 42, alignSelf: 'center', overflow: 'hidden', paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: '#00000080', color: '#FFFFFF', fontSize: 12 },
});
