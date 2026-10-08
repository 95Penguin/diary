import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Modal, PanResponder, SectionList, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TimePixelColorPicker } from '@/components/time-pixel-color-picker';
import { ButtonLabel, CompactPillButton, PrimaryButton, buttonMetrics } from '@/components/ui/buttons';
import {
  createTimePixelCategory,
  deleteTimePixelRange,
  getTimePixelSnapshot,
  initializeTimePixels,
  saveTimePixelPreferences,
  saveTimePixelRange,
  updateTimePixelCategory,
  type TimePixelCategory,
  type TimePixelKind,
  type TimePixelRange,
  type TimePixelRangeMode,
  type TimePixelSettings,
  type TimePixelSnapshot,
  type TimePixelUnit,
} from '@/database/time-pixel-repository';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { buildPixelGroups, buildPixelSections, hasTimePixelRangeOnDate, labelForPixelGroup, type PixelGroup } from '@/utils/time-pixel-display';
import { timePixelSaveImpact } from '@/utils/time-pixel-impact';
import { EARLIEST_TIME_PIXEL_DATE, EARLIEST_TIME_PIXEL_YEAR, isTimePixelDate } from '@/utils/time-pixels';

import { TIME_PIXEL_PALETTE as PALETTE, suggestedTimePixelColor, timePixelColor as categoryColor, timePixelTextColor } from '@/utils/time-pixel-colors';

type EditorState = { kind: TimePixelKind; range: TimePixelRange | null } | null;
type ViewPreferences = Partial<Pick<TimePixelSettings, 'originDate' | 'endYear' | 'unitCustomized' | 'rangeMode' | 'selectedYear' | 'unit' | 'colorMode'>>;
type ReturnView = Pick<TimePixelSettings, 'originDate' | 'endYear' | 'rangeMode' | 'selectedYear' | 'unit'> & { scrollOffset: number };
type InlineNotice = { title: string; message: string };

const YEAR_WHEEL_ITEM_HEIGHT = 48;

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function formatDate(value: string) { const [year, month, day] = value.split('-').map(Number); return `${year}年${month}月${day}日`; }
function formatRange(start: string, end: string) { return start === end ? formatDate(start) : `${formatDate(start)}—${formatDate(end)}`; }
function kindLabel(kind: TimePixelKind) { return kind === 'location' ? '地点' : '人生阶段'; }
function unitLabel(unit: TimePixelUnit) { return unit === 'day' ? '天' : unit === 'month' ? '月' : '年'; }

export default function TimePixelsScreen() {
  const db = useSQLiteContext();
  const { readingTheme } = useAppPreferences();
  const { width } = useWindowDimensions();
  const today = todayKey();
  const currentYear = Number(today.slice(0, 4));
  const [snapshot, setSnapshot] = useState<TimePixelSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [rangeVisible, setRangeVisible] = useState(false);
  const [rangeModeDraft, setRangeModeDraft] = useState<TimePixelRangeMode>('all');
  const [rangeYearDraft, setRangeYearDraft] = useState(currentYear);
  const [rangeStartDraft, setRangeStartDraft] = useState(currentYear);
  const [rangeEndDraft, setRangeEndDraft] = useState<number | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [detail, setDetail] = useState<PixelGroup | null>(null);
  const [managerVisible, setManagerVisible] = useState(false);
  const [managerCategory, setManagerCategory] = useState<TimePixelCategory | null>(null);
  const [pageNotice, setPageNotice] = useState<string | null>(null);
  const [savedOutsideYear, setSavedOutsideYear] = useState<number | null>(null);
  const [editorNotice, setEditorNotice] = useState<InlineNotice | null>(null);
  const [managerNotice, setManagerNotice] = useState<InlineNotice | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<TimePixelRange | null>(null);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);
  const [focusedCategoryId, setFocusedCategoryId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const [confirmation, setConfirmation] = useState<{ signature: string; message: string } | null>(null);
  const [returnView, setReturnView] = useState<ReturnView | null>(null);
  const [restoreOffset, setRestoreOffset] = useState<number | null>(null);
  const scrollOffset = useRef(0);
  const visibleOffset = useRef(0);
  const [editorCategoryId, setEditorCategoryId] = useState<string | 'new'>('new');
  const [editorName, setEditorName] = useState('');
  const [editorColor, setEditorColor] = useState<string>(PALETTE[0].token);
  const [editorStart, setEditorStart] = useState(today);
  const [editorEnd, setEditorEnd] = useState(today);
  const [editorDateMode, setEditorDateMode] = useState<'day' | 'range'>('day');
  const [editorNote, setEditorNote] = useState('');
  const [managerName, setManagerName] = useState('');
  const [managerColor, setManagerColor] = useState<string>(PALETTE[0].token);
  const preferenceQueue = useRef<Promise<void>>(Promise.resolve());
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      let pending: Promise<void>;
      let data: TimePixelSnapshot;
      do {
        pending = preferenceQueue.current;
        await pending;
        data = await getTimePixelSnapshot(db);
        if (!data.settings) {
          await initializeTimePixels(db, `${new Date().getFullYear()}-01-01`);
          await saveTimePixelPreferences(db, { rangeMode: 'year', selectedYear: new Date().getFullYear(), unit: 'day' });
          data = await getTimePixelSnapshot(db);
        }
      } while (pending !== preferenceQueue.current);
      if (sequence !== loadSequence.current) return;
      setSnapshot(data);
      setLoadError(false);
    } catch { if (sequence === loadSequence.current) setLoadError(true); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [db]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const settings = snapshot?.settings ?? null;
  const built = useMemo(() => snapshot && settings ? buildPixelGroups(snapshot, settings, today) : null, [settings, snapshot, today]);
  const activeCategories = useMemo(() => snapshot && settings ? snapshot.categories.filter((item) => item.kind === settings.colorMode) : [], [settings, snapshot]);
  const categoryById = useMemo(() => new Map((snapshot?.categories ?? []).map((item) => [item.id, item])), [snapshot]);
  const activeCategoryOrder = useMemo(() => new Map(activeCategories.map((item, index) => [item.id, index])), [activeCategories]);
  const visibleCategories = useMemo(() => activeCategories.filter((item) => (built?.totals.get(item.id) ?? 0) > 0), [activeCategories, built?.totals]);
  const focusedCandidate = focusedCategoryId ? categoryById.get(focusedCategoryId) : null;
  const focusedCategory = focusedCandidate && focusedCandidate.kind === settings?.colorMode ? focusedCandidate : null;
  const columns = settings?.unit === 'day' ? 20 : settings?.unit === 'month' ? 6 : 4;
  const contentWidth = Math.min(width, 720) - spacing.xl * 2;
  const gridPadding = spacing.md * 2;
  const cellGap = settings?.unit === 'day' ? 3 : spacing.sm;
  const cellWidth = Math.max(5, (contentWidth - gridPadding - cellGap * (columns - 1)) / columns);
  const sections = useMemo(() => buildPixelSections(built?.groups ?? [], settings?.unit ?? 'day', columns), [built?.groups, columns, settings?.unit]);
  const yearSwipeHandlers = useYearSwipeHandlers(settings?.rangeMode === 'year' && !saving, changeYearFromSwipe);

  async function updatePreferences(next: ViewPreferences) {
    if (!settings) return;
    setSnapshot((current) => current?.settings ? { ...current, settings: { ...current.settings, ...next } } : current);
    if (next.colorMode) setFocusedCategoryId(null);
    const pending = preferenceQueue.current.then(() => saveTimePixelPreferences(db, next));
    preferenceQueue.current = pending.catch(() => undefined);
    try { await pending; setPageNotice(null); return true; }
    catch { await load(); setPageNotice('设置没有保存，请稍后重试。'); return false; }
  }

  async function expandYear(year: number, unit: 'month' | 'day') {
    if (!settings) return;
    const firstExpansion = !returnView;
    if (firstExpansion) setReturnView({ originDate: settings.originDate, endYear: settings.endYear, rangeMode: settings.rangeMode, selectedYear: settings.selectedYear, unit: settings.unit, scrollOffset: scrollOffset.current });
    setDetail(null);
    const saved = await updatePreferences({ rangeMode: 'year', selectedYear: year, unit });
    if (!saved && firstExpansion) setReturnView(null);
  }

  async function restoreView() {
    if (!returnView) return;
    const year = returnView.selectedYear;
    const valid = year !== null && year >= EARLIEST_TIME_PIXEL_YEAR && year <= Number(today.slice(0, 4));
    const { scrollOffset: savedOffset, ...savedView } = returnView;
    setRestoreOffset(savedOffset);
    const saved = await updatePreferences(savedView.rangeMode === 'year' && !valid ? { ...savedView, rangeMode: 'all', selectedYear: null } : savedView);
    if (saved) setReturnView(null);
    else setRestoreOffset(null);
  }

  function openRangePicker() {
    if (!settings) return;
    const selectedYear = settings.rangeMode === 'year' && settings.selectedYear !== null ? settings.selectedYear : currentYear;
    setRangeModeDraft(settings.rangeMode);
    setRangeYearDraft(selectedYear);
    setRangeStartDraft(Number(settings.originDate.slice(0, 4)));
    setRangeEndDraft(settings.endYear ?? null);
    setRangeVisible(true);
  }

  function openManagerSettings() {
    if (!settings || saving) return;
    setManagerCategory(null);
    setManagerNotice(null);
    setManagerVisible(true);
  }

  async function applyRange() {
    if (saving || !settings) return;
    const single = rangeModeDraft === 'year' || rangeStartDraft === rangeEndDraft;
    if (!single && rangeStartDraft > (rangeEndDraft ?? currentYear)) return;
    setSaving(true);
    const next: ViewPreferences = single
      ? { rangeMode: 'year', selectedYear: rangeModeDraft === 'year' ? rangeYearDraft : rangeStartDraft }
      : { rangeMode: 'all', selectedYear: null, originDate: `${rangeStartDraft}-01-01`, endYear: rangeEndDraft };
    if (!settings.unitCustomized) next.unit = single ? 'day' : 'month';
    const saved = await updatePreferences(next);
    if (saved) { setRangeVisible(false); setReturnView(null); setSavedOutsideYear(null); }
    setSaving(false);
  }

  async function changeYear(delta: number) {
    if (!settings || settings.rangeMode !== 'year' || saving) return;
    const year = (settings.selectedYear ?? currentYear) + delta;
    if (year < EARLIEST_TIME_PIXEL_YEAR || year > currentYear) return;
    setSaving(true);
    setRestoreOffset(visibleOffset.current);
    await updatePreferences({ rangeMode: 'year', selectedYear: year });
    setSavedOutsideYear(null);
    setSaving(false);
  }

  function changeYearFromSwipe(horizontalDistance: number) {
    // Right swipe moves back in time; left swipe moves forward.
    void changeYear(horizontalDistance > 0 ? -1 : 1);
  }

  function openCreate(kind: TimePixelKind, date = today) {
    setConfirmation(null);
    setEditorNotice(null);
    setDeleteCandidate(null);
    const categories = snapshot?.categories.filter((item) => item.kind === kind) ?? [];
    setEditor({ kind, range: null });
    setDetail(null);
    setEditorDateMode('day');
    setEditorCategoryId(focusedCategory?.kind === kind ? focusedCategory.id : categories[0]?.id ?? 'new');
    setEditorName('');
    setEditorColor(suggestedTimePixelColor(snapshot?.categories ?? [], kind));
    setEditorStart(date);
    setEditorEnd(date);
    setEditorNote('');
  }

  function openEdit(range: TimePixelRange) {
    setConfirmation(null);
    setEditorNotice(null);
    setDeleteCandidate(null);
    setDetail(null);
    setEditor({ kind: range.kind, range });
    setEditorCategoryId(range.categoryId);
    setEditorName('');
    setEditorColor(suggestedTimePixelColor(snapshot?.categories ?? [], range.kind));
    setEditorStart(range.startDate);
    setEditorEnd(range.endDate);
    setEditorDateMode(range.startDate === range.endDate ? 'day' : 'range');
    setEditorNote(range.note ?? '');
  }

  async function saveRange(confirmedSignature?: string) {
    if (!editor || !settings || saveLock.current) return;
    if (!isTimePixelDate(editorStart) || !isTimePixelDate(editorEnd) || editorStart > editorEnd || editorStart < EARLIEST_TIME_PIXEL_DATE || editorEnd > today) {
      setEditorNotice({ title: '日期范围不正确', message: `请选择 ${formatDate(EARLIEST_TIME_PIXEL_DATE)} 至今天之间的日期。` });
      return;
    }
    if (editorCategoryId === 'new' && !editorName.trim()) {
      setEditorNotice({ title: '还没有名称', message: '请先填写名称。' });
      return;
    }
    setEditorNotice(null);
    saveLock.current = true;
    setSaving(true);
    let createdCategory = false;
    try {
      const latest = await getTimePixelSnapshot(db);
      const impact = timePixelSaveImpact(latest.ranges, { kind: editor.kind, id: editor.range?.id, startDate: editorStart, endDate: editorEnd, note: editorNote });
      if ((impact.overwrittenDays > 0 || impact.removedDays > 0) && confirmedSignature !== impact.signature) {
        Keyboard.dismiss();
        const names = new Map(latest.categories.map((item) => [item.id, item.name]));
        const affected = impact.byCategory.map((item) => `「${names.get(item.categoryId) ?? '未命名'}」${item.days} 天`).join('、');
        setConfirmation({
          signature: impact.signature,
          message: [
            `本次保存 ${impact.totalDays} 天。`,
            impact.overwrittenDays ? `其中 ${impact.overwrittenDays} 天已有记录：${affected}。这些日期将使用本次的分类和备注。` : '',
            impact.changedNotes ? `涉及 ${impact.changedNotes} 段不同的原备注；重叠日期内的原备注将被替换（本次留空则清除）。` : '',
            impact.removedDays ? `调整日期后，原记录中有 ${impact.removedDays} 天不再保留。` : '',
            '重叠范围外的其他记录及另一条时间层不受影响。',
          ].filter(Boolean).join('\n\n'),
        });
        return;
      }
      let categoryId = editorCategoryId;
      if (categoryId === 'new') {
        categoryId = await createTimePixelCategory(db, { kind: editor.kind, name: editorName, colorToken: editorColor });
        createdCategory = true;
        setEditorCategoryId(categoryId);
      }
      await saveTimePixelRange(db, { id: editor.range?.id, categoryId, startDate: editorStart, endDate: editorEnd, note: editorNote, expectedImpactSignature: impact.signature });
      setEditor(null);
      setConfirmation(null);
      await load();
      if (built && (editorStart < built.bounds.start || editorEnd > built.bounds.end)) {
        setSavedOutsideYear(Number((editorStart < built.bounds.start ? editorStart : editorEnd).slice(0, 4)));
      } else setSavedOutsideYear(null);
    } catch (error) {
      setConfirmation(null);
      // If category creation succeeded but range saving failed, refresh so the
      // newly created category remains selectable when the editor stays open.
      if (createdCategory) await load();
      const duplicate = error instanceof Error && error.message === 'duplicate-category';
      const changed = error instanceof Error && error.message === 'time-pixel-conflict-changed';
      setEditorNotice({ title: changed ? '记录已发生变化' : duplicate ? '名称已经存在' : '保存失败', message: changed ? '本次没有覆盖任何日期。请再次保存，重新确认受影响的记录。' : duplicate ? '请选择已有项目，或换一个名称。' : '这段时间没有保存，请稍后重试。' });
    } finally { saveLock.current = false; setSaving(false); }
  }

  async function removeRange() {
    if (!deleteCandidate || saving) return;
    setSaving(true);
    setDeleteNotice(null);
    try { await deleteTimePixelRange(db, deleteCandidate.id); setDeleteCandidate(null); setDetail(null); await load(); }
    catch { setDeleteNotice('删除没有完成，请稍后重试。'); }
    finally { setSaving(false); }
  }

  function openManagerCategory(category: TimePixelCategory) {
    setManagerNotice(null);
    setManagerCategory(category);
    setManagerName(category.name);
    setManagerColor(category.colorToken);
  }

  async function saveManager() {
    if (!settings || saving) return;
    setManagerNotice(null);
    setSaving(true);
    try {
      if (managerCategory) {
        await updateTimePixelCategory(db, managerCategory.id, { name: managerName, colorToken: managerColor });
        setManagerCategory(null);
      }
      await load();
    } catch (error) {
      const duplicate = error instanceof Error && error.message === 'duplicate-category';
      setManagerNotice({ title: duplicate ? '名称已经存在' : '保存失败', message: duplicate ? '请换一个名称。' : '修改没有保存，请稍后重试。' });
    } finally { setSaving(false); }
  }

  if (loading) return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}><ActivityIndicator color={colors.primary} style={styles.loader} /></SafeAreaView>;
  if (loadError || !snapshot) return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}><PageHeader title="时光像素" /><View style={styles.failure}><Text style={[styles.failureTitle, { color: readingTheme.text }]}>时光像素暂时没有打开</Text><Text style={[styles.failureText, { color: readingTheme.secondary }]}>记录仍保存在本机，可以重新加载。</Text><PrimaryButton onPress={() => { setLoading(true); void load(); }}><ButtonLabel>重新加载</ButtonLabel></PrimaryButton></View></SafeAreaView>;

  if (!settings) return null;

  const recorded = focusedCategory ? built?.totals.get(focusedCategory.id) ?? 0 : built?.recordedDays ?? 0;
  const ratio = focusedCategory && built?.recordedDays ? recorded / built.recordedDays : 0;
  const originYear = Number(settings.originDate.slice(0, 4));
  const selectedLabel = settings.rangeMode === 'all' ? settings.endYear ? `${originYear}—${settings.endYear}年` : `${originYear}年至今` : `${settings.selectedYear}年`;
  const detailRanges = detail ? snapshot.ranges.filter((range) => range.startDate <= detail.endDate && range.endDate >= detail.startDate).sort((a, b) => a.kind.localeCompare(b.kind) || a.startDate.localeCompare(b.startDate)) : [];

  const listHeader = <>
    {returnView ? <Pressable onPress={() => void restoreView()} style={styles.returnButton}><Text style={styles.returnText}>‹ 返回展开前视图</Text></Pressable> : null}
    <View style={styles.controlsRow}>
      <Pressable accessibilityLabel={`查看范围，${selectedLabel}`} onPress={openRangePicker} style={[styles.rangeButton, { backgroundColor: readingTheme.surface }]}><Text style={styles.rangeButtonText}>{selectedLabel}</Text><View style={styles.chevron} /></Pressable>
      <View accessibilityLabel="每格显示单位" accessibilityRole="radiogroup" style={[styles.segmented, { backgroundColor: readingTheme.surface }]}>{(['year', 'month', 'day'] as TimePixelUnit[]).map((unit) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: settings.unit === unit }} key={unit} onPress={() => void updatePreferences({ unit, unitCustomized: true })} style={[styles.segment, settings.unit === unit && styles.segmentActive]}><Text style={[styles.segmentText, settings.unit === unit && styles.segmentTextActive]}>{unitLabel(unit)}</Text></Pressable>)}</View>
    </View>
    <View accessibilityRole="radiogroup" style={styles.modeRow}>{(['location', 'stage'] as TimePixelKind[]).map((kind) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: settings.colorMode === kind }} key={kind} onPress={() => void updatePreferences({ colorMode: kind })} style={[styles.modeButton, { borderBottomColor: settings.colorMode === kind ? colors.primary : 'transparent' }]}><Text style={[styles.modeText, { color: settings.colorMode === kind ? colors.primary : readingTheme.secondary }]}>{kind === 'location' ? '按地点着色' : '按阶段着色'}</Text></Pressable>)}</View>
    <View style={styles.filterLine}><Pressable onPress={() => setFocusedCategoryId(null)} style={[styles.filterChip, { backgroundColor: focusedCategoryId ? readingTheme.surface : colors.primarySoft }]}><Text style={[styles.filterText, !focusedCategoryId && styles.filterTextActive]}>全部</Text></Pressable><ScrollView horizontal style={styles.filterScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>{activeCategories.map((category) => <Pressable key={category.id} onPress={() => setFocusedCategoryId(category.id)} style={[styles.filterChip, { backgroundColor: focusedCategoryId === category.id ? colors.primarySoft : readingTheme.surface }]}><View style={[styles.swatch, { backgroundColor: categoryColor(category.colorToken) }]} /><Text numberOfLines={1} style={[styles.filterText, focusedCategoryId === category.id && styles.filterTextActive]}>{category.name}</Text></Pressable>)}</ScrollView><Pressable accessibilityLabel="管理名称与颜色" onPress={openManagerSettings} style={[styles.manageButton, { backgroundColor: readingTheme.surface }]}><SymbolView name={{ ios: 'slider.horizontal.3', android: 'tune', web: 'tune' }} size={16} tintColor={colors.primary} /></Pressable></View>
    <View style={[styles.pixelCard, { backgroundColor: readingTheme.surface }]}>
      <View style={styles.summaryRow}><View><Text style={[styles.summaryLabel, { color: readingTheme.secondary }]}>{focusedCategory ? `在${focusedCategory.name}度过` : `已记录${settings.colorMode === 'location' ? '地点' : '阶段'}的日子`}</Text><View style={styles.summaryValue}><Text style={[styles.summaryNumber, { color: readingTheme.text }]}>{recorded}</Text><Text style={[styles.summaryUnit, { color: readingTheme.text }]}>天</Text></View></View><View style={styles.summaryMeta}><Text style={[styles.summaryMetaText, { color: readingTheme.secondary }]}>{focusedCategory ? `占已记录日子的 ${(ratio * 100).toFixed(1)}%` : `所选时段已过 ${built?.elapsedDays ?? 0} 天`}</Text><Text style={[styles.summaryMetaText, { color: readingTheme.secondary }]}>{built?.groups.length ?? 0}格 · 每格一{unitLabel(settings.unit)}</Text></View></View>
    </View>
  </>;

  const listFooter = <>
    <View style={[styles.axis, { paddingHorizontal: spacing.md, backgroundColor: readingTheme.surface }]}><Text style={[styles.axisText, { color: readingTheme.secondary }]}>{built ? formatDate(built.bounds.start) : ''}</Text><Text style={[styles.axisText, { color: readingTheme.secondary }]}>{built ? formatDate(built.bounds.end) : ''}</Text></View>
    <View style={[styles.legend, { paddingHorizontal: spacing.md }]}>{visibleCategories.map((category) => <View key={category.id} style={styles.legendItem}><View style={[styles.swatch, { backgroundColor: categoryColor(category.colorToken) }]} /><Text style={[styles.legendText, { color: readingTheme.secondary }]}>{category.name}</Text></View>)}<View style={styles.legendItem}><View style={[styles.swatch, { backgroundColor: readingTheme.border }]} /><Text style={[styles.legendText, { color: readingTheme.secondary }]}>未记录</Text></View>{built && built.futureDays > 0 ? <View style={styles.legendItem}><View style={[styles.swatch, { backgroundColor: readingTheme.background, borderWidth: 1, borderColor: readingTheme.border }]} /><Text style={[styles.legendText, { color: readingTheme.secondary }]}>未来</Text></View> : null}</View>
    <PrimaryButton onPress={() => openCreate(settings.colorMode)} style={styles.addButton}><ButtonLabel>＋ {settings.colorMode === 'location' ? '记录所在地点' : '添加人生阶段'}</ButtonLabel></PrimaryButton>
  </>;

  return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <PageHeader title="时光像素" right={<Pressable accessibilityLabel="时光像素设置" hitSlop={12} onPress={openManagerSettings}><SymbolView name={{ ios: 'slider.horizontal.3', android: 'tune', web: 'tune' }} size={19} tintColor={colors.primary} /></Pressable>} />
    {pageNotice ? <View accessibilityRole="alert" style={[styles.pageNotice, { backgroundColor: readingTheme.surface }]}><Text style={[styles.pageNoticeText, { color: readingTheme.text }]}>{pageNotice}</Text><Pressable onPress={() => setPageNotice(null)} hitSlop={10}><Text style={styles.pageNoticeAction}>知道了</Text></Pressable></View> : null}
    {savedOutsideYear !== null ? <View accessibilityRole="alert" style={[styles.pageNotice, { backgroundColor: readingTheme.surface }]}><Text style={[styles.pageNoticeText, { color: readingTheme.text }]}>已保存，记录在当前范围之外</Text><Pressable disabled={saving} onPress={() => { void updatePreferences({ rangeMode: 'year', selectedYear: savedOutsideYear, ...(!settings.unitCustomized ? { unit: 'day' as const } : {}) }).then((ok) => { if (ok) { setSavedOutsideYear(null); setReturnView(null); } }); }}><Text style={styles.pageNoticeAction}>查看 {savedOutsideYear} 年</Text></Pressable><Pressable accessibilityLabel="关闭保存提示" onPress={() => setSavedOutsideYear(null)} hitSlop={8}><Text style={styles.pageNoticeAction}>×</Text></Pressable></View> : null}
    <SectionList
      key={`${settings.rangeMode}-${settings.selectedYear}-${settings.unit}-${settings.originDate}-${settings.endYear}`}
      sections={sections}
      contentOffset={restoreOffset === null ? undefined : { x: 0, y: restoreOffset }}
      onLayout={() => { if (restoreOffset !== null) requestAnimationFrame(() => setRestoreOffset(null)); }}
      onScroll={(event) => { visibleOffset.current = event.nativeEvent.contentOffset.y; if (!returnView) scrollOffset.current = visibleOffset.current; }}
      scrollEventThrottle={16}
      stickySectionHeadersEnabled
      renderSectionHeader={({ section }) => <View style={[styles.yearHeader, { backgroundColor: readingTheme.surface, borderBottomColor: readingTheme.border }]}>
        {settings.rangeMode === 'year' ? <View style={styles.yearNavigation}><Pressable accessibilityLabel="上一年" disabled={saving || settings.selectedYear === EARLIEST_TIME_PIXEL_YEAR} onPress={() => void changeYear(-1)} style={[styles.yearArrow, (saving || settings.selectedYear === EARLIEST_TIME_PIXEL_YEAR) && styles.disabledText]}><Text style={styles.returnText}>‹</Text></Pressable><Pressable accessibilityLabel="选择查看年份" onPress={openRangePicker}><Text style={[styles.yearTitle, { color: readingTheme.text }]}>{settings.selectedYear}年</Text></Pressable><Pressable accessibilityLabel="下一年" disabled={saving || settings.selectedYear === currentYear} onPress={() => void changeYear(1)} style={[styles.yearArrow, (saving || settings.selectedYear === currentYear) && styles.disabledText]}><Text style={styles.returnText}>›</Text></Pressable></View> : <Text accessibilityRole="header" style={[styles.yearTitle, { color: readingTheme.text }]}>{section.title}</Text>}
        {section.year !== null && settings.rangeMode === 'all' ? <Pressable accessibilityLabel={`单独查看${section.year}年`} onPress={() => void expandYear(section.year!, settings.unit === 'day' ? 'day' : 'month')} style={styles.yearAction}><Text style={styles.returnText}>单独查看 ›</Text></Pressable> : <Text style={[styles.axisText, { color: readingTheme.secondary }]}>每格一{unitLabel(settings.unit)}</Text>}
      </View>}
      keyExtractor={(row) => row[0]?.key ?? 'empty'}
      renderItem={({ item: row }) => <YearSwipeRow panHandlers={yearSwipeHandlers} style={[styles.pixelRow, { gap: cellGap, backgroundColor: readingTheme.surface }]}>{row.map((group) => <PixelCell key={group.key} group={group} unit={settings.unit} categoryById={categoryById} categoryOrder={activeCategoryOrder} focusedCategory={focusedCategory} readingBorder={readingTheme.border} surfaceMuted={readingTheme.background} width={cellWidth} selected={detail?.key === group.key} onPress={() => {
        if (settings.unit === 'day' && group.startDate <= today && !hasTimePixelRangeOnDate(snapshot.ranges, settings.colorMode, group.startDate)) openCreate(settings.colorMode, group.startDate);
        else setDetail(group);
      }} />)}{row.length < columns ? Array.from({ length: columns - row.length }, (_, index) => <View key={`blank-${index}`} style={{ width: cellWidth }} />) : null}</YearSwipeRow>}
      ListHeaderComponent={listHeader}
      ListFooterComponent={listFooter}
      ListEmptyComponent={<View style={styles.emptyPixels}><Text style={[styles.failureText, { color: readingTheme.secondary }]}>这个范围内还没有可显示的时间。</Text></View>}
      contentContainerStyle={styles.list}
      initialNumToRender={18}
      windowSize={9}
      removeClippedSubviews={Platform.OS === 'android'}
      showsVerticalScrollIndicator={false}
    />

    <CenteredPanel resetKey={`range-${rangeVisible}`} visible={rangeVisible} onClose={() => { if (!saving) setRangeVisible(false); }} backgroundColor={readingTheme.background} closeColor={readingTheme.secondary} contentContainerStyle={styles.rangeDialogContent}>
      <Text style={[styles.sheetTitle, { color: readingTheme.text }]}>查看范围</Text>
      <View accessibilityRole="radiogroup" style={[styles.rangeModeSwitch, { backgroundColor: readingTheme.surface }]}>
        {(['year', 'all'] as const).map((mode) => <Pressable key={mode} accessibilityRole="radio" accessibilityState={{ checked: rangeModeDraft === mode }} disabled={saving} onPress={() => setRangeModeDraft(mode)} style={[styles.rangeModeChoice, rangeModeDraft === mode && styles.rangeModeChoiceActive]}><Text style={[styles.rangeModeChoiceText, rangeModeDraft === mode && styles.rangeModeChoiceTextActive]}>{mode === 'year' ? '一年' : '多年'}</Text></Pressable>)}
      </View>
      <View pointerEvents={saving ? 'none' : 'auto'}>
        {rangeModeDraft === 'year' ? <YearWheelPicker key={`single-${rangeVisible}`} value={rangeYearDraft} onChange={setRangeYearDraft} minimumYear={EARLIEST_TIME_PIXEL_YEAR} maximumYear={currentYear} surfaceColor={readingTheme.surface} textColor={readingTheme.text} secondaryColor={readingTheme.secondary} /> : <View style={styles.rangeWheels}>
          <View style={styles.rangeWheelColumn}><Text style={[styles.wheelCaption, { color: readingTheme.secondary }]}>开始年份</Text><YearWheelPicker key={`start-${rangeVisible}`} value={rangeStartDraft} onChange={setRangeStartDraft} minimumYear={EARLIEST_TIME_PIXEL_YEAR} maximumYear={currentYear} surfaceColor={readingTheme.surface} textColor={readingTheme.text} secondaryColor={readingTheme.secondary} /></View>
          <View style={styles.rangeWheelColumn}><Text style={[styles.wheelCaption, { color: readingTheme.secondary }]}>结束年份</Text><YearWheelPicker key={`end-${rangeVisible}`} includePresent value={rangeEndDraft ?? currentYear + 1} onChange={(year) => setRangeEndDraft(year === currentYear + 1 ? null : year)} minimumYear={EARLIEST_TIME_PIXEL_YEAR} maximumYear={currentYear} surfaceColor={readingTheme.surface} textColor={readingTheme.text} secondaryColor={readingTheme.secondary} /></View>
        </View>}
      </View>
      {rangeModeDraft === 'all' && rangeStartDraft > (rangeEndDraft ?? currentYear) ? <Text accessibilityRole="alert" style={styles.inlineError}>开始年份不能晚于结束年份</Text> : null}
      <PrimaryButton disabled={saving || (rangeModeDraft === 'all' && rangeStartDraft > (rangeEndDraft ?? currentYear))} onPress={() => void applyRange()} style={styles.rangeApply}><ButtonLabel>{saving ? '正在切换…' : rangeModeDraft === 'year' ? `查看 ${rangeYearDraft} 年` : rangeEndDraft === null ? `查看 ${rangeStartDraft} 年至今` : rangeStartDraft === rangeEndDraft ? `查看 ${rangeStartDraft} 年` : `查看 ${rangeStartDraft}—${rangeEndDraft} 年`}</ButtonLabel></PrimaryButton>
    </CenteredPanel>

    <CenteredPanel resetKey={editor ? (confirmation ? 'confirm' : 'form') : deleteCandidate ? 'delete' : `detail-${detail?.key ?? ''}`} visible={Boolean(detail || editor)} onClose={() => { if (saveLock.current) return; setEditor(null); setConfirmation(null); setEditorNotice(null); setDeleteCandidate(null); setDeleteNotice(null); setDetail(null); }} backgroundColor={readingTheme.background} closeColor={readingTheme.secondary} contentContainerStyle={styles.dialogContent}>
      <View pointerEvents={saving ? 'none' : 'auto'}>
      {editor && confirmation ? <View><Text style={[styles.sheetTitle, { color: readingTheme.text }]}>确认修改这些日子？</Text><Text style={[styles.confirmationCopy, { color: readingTheme.text }]}>{confirmation.message}</Text><PrimaryButton disabled={saving} onPress={() => void saveRange(confirmation.signature)} style={styles.sheetPrimary}><ButtonLabel>{saving ? '正在保存…' : '确认修改'}</ButtonLabel></PrimaryButton><Pressable disabled={saving} onPress={() => setConfirmation(null)} style={styles.sheetCancel}><Text style={[styles.sheetCancelText, { color: readingTheme.secondary }]}>返回修改，不保存</Text></Pressable></View> : editor ? <><Text style={[styles.sheetTitle, styles.formSheetTitle, { color: readingTheme.text }]}>{editor.range ? `编辑${kindLabel(editor.kind)}` : editor.kind === 'location' ? '记录所在地点' : '添加人生阶段'}</Text>{editorNotice ? <InlineNoticeCard notice={editorNotice} backgroundColor={readingTheme.surface} textColor={readingTheme.text} secondaryColor={readingTheme.secondary} /> : null}<Text style={[styles.formLabel, styles.firstFormLabel, { color: readingTheme.secondary }]}>{kindLabel(editor.kind)}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>{snapshot.categories.filter((item) => item.kind === editor.kind).map((category) => <CompactPillButton key={category.id} onPress={() => setEditorCategoryId(category.id)} style={[styles.categoryChoice, { backgroundColor: editorCategoryId === category.id ? colors.primarySoft : readingTheme.surface }]}><View style={[styles.swatch, { backgroundColor: categoryColor(category.colorToken) }]} /><Text style={[styles.categoryChoiceText, { color: editorCategoryId === category.id ? colors.primary : readingTheme.text }]}>{category.name}</Text></CompactPillButton>)}<CompactPillButton onPress={() => setEditorCategoryId('new')} style={[styles.categoryChoice, { backgroundColor: editorCategoryId === 'new' ? colors.primarySoft : readingTheme.surface }]}><Text style={styles.newChoiceText}>＋ 新建</Text></CompactPillButton></ScrollView>{editorCategoryId === 'new' ? <><Text style={[styles.formLabel, { color: readingTheme.secondary }]}>名称</Text><TextInput value={editorName} onChangeText={setEditorName} maxLength={30} placeholder={editor.kind === 'location' ? '例如：老家、学校宿舍、上海' : '例如：上小学、上大学、工作'} placeholderTextColor={readingTheme.secondary} style={[styles.input, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} /><TimePixelColorPicker key={`${editor.kind}-${editor.range?.id ?? "new"}`} collapsible value={editorColor} onChange={setEditorColor} categories={snapshot.categories} kind={editor.kind} name={editorName} /></> : null}<View accessibilityRole="radiogroup" style={[styles.rangeModeSwitch, styles.recordMode, { backgroundColor: readingTheme.surface }]}>{(['day', 'range'] as const).map((mode) => <Pressable key={mode} accessibilityRole="radio" accessibilityState={{ checked: editorDateMode === mode }} onPress={() => { setEditorDateMode(mode); if (mode === 'day') setEditorEnd(editorStart); }} style={[styles.rangeModeChoice, editorDateMode === mode && styles.rangeModeChoiceActive]}><Text style={[styles.rangeModeChoiceText, editorDateMode === mode && styles.rangeModeChoiceTextActive]}>{mode === 'day' ? '一天' : '一段时间'}</Text></Pressable>)}</View><View style={styles.dateRow}><DateField label={editorDateMode === 'day' ? '日期' : '开始日期'} value={editorStart} onChange={(date) => { setEditorStart(date); if (editorDateMode === 'day' || date > editorEnd) setEditorEnd(date); }} minimumDate={EARLIEST_TIME_PIXEL_DATE} maximumDate={today} backgroundColor={readingTheme.surface} textColor={readingTheme.text} secondaryColor={readingTheme.secondary} />{editorDateMode === 'range' ? <DateField label="结束日期" value={editorEnd} onChange={setEditorEnd} minimumDate={isTimePixelDate(editorStart) ? editorStart : EARLIEST_TIME_PIXEL_DATE} maximumDate={today} backgroundColor={readingTheme.surface} textColor={readingTheme.text} secondaryColor={readingTheme.secondary} /> : null}</View><Text style={[styles.formLabel, { color: readingTheme.secondary }]}>备注（选填）</Text><TextInput multiline value={editorNote} onChangeText={setEditorNote} maxLength={160} placeholder={editorDateMode === 'day' ? '写下这一天发生的事' : '写下这段时间发生的事'} placeholderTextColor={readingTheme.secondary} textAlignVertical="top" style={[styles.input, styles.noteInput, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} /><Text style={[styles.overwriteHint, { color: readingTheme.secondary }]}>{'同类记录发生重叠时，新记录会替换重叠日期；另一条时间层不受影响。'}</Text><PrimaryButton disabled={saving} onPress={() => void saveRange()} style={styles.sheetPrimary}><ButtonLabel>{saving ? '正在保存…' : editor.range ? '保存修改' : '保存'}</ButtonLabel></PrimaryButton></> : deleteCandidate ? <View><Text style={[styles.sheetTitle, { color: readingTheme.text }]}>删除这段记录？</Text><Text style={[styles.confirmationCopy, { color: readingTheme.text }]}>{categoryById.get(deleteCandidate.categoryId)?.name ?? kindLabel(deleteCandidate.kind)}{`\n${formatRange(deleteCandidate.startDate, deleteCandidate.endDate)}`}</Text>{deleteNotice ? <Text accessibilityRole="alert" style={styles.inlineError}>{deleteNotice}</Text> : null}<PrimaryButton disabled={saving} onPress={() => void removeRange()} style={styles.sheetPrimary}><ButtonLabel>{saving ? '正在删除…' : '确认删除'}</ButtonLabel></PrimaryButton><Pressable disabled={saving} onPress={() => { setDeleteCandidate(null); setDeleteNotice(null); }} style={styles.sheetCancel}><Text style={[styles.sheetCancelText, { color: readingTheme.secondary }]}>取消</Text></Pressable></View> : detail ? <><Text style={[styles.sheetTitle, { color: readingTheme.text }]}>{formatRange(detail.startDate, detail.endDate)}</Text>{settings.unit === 'year' ? <View style={styles.drillRow}><Pressable style={[styles.drillButton, { backgroundColor: readingTheme.surface }]} onPress={() => void expandYear(Number(detail.key), 'month')}><Text style={styles.returnText}>按月展开</Text></Pressable><Pressable style={[styles.drillButton, { backgroundColor: readingTheme.surface }]} onPress={() => void expandYear(Number(detail.key), 'day')}><Text style={styles.returnText}>按天展开</Text></Pressable></View> : null}{detailRanges.length ? detailRanges.map((range) => { const category = categoryById.get(range.categoryId); return <View key={range.id} style={[styles.detailRow, { backgroundColor: readingTheme.surface }]}><View style={[styles.detailBar, { backgroundColor: categoryColor(category?.colorToken ?? 'fern') }]} /><View style={styles.detailCopy}><Text style={[styles.detailKind, { color: readingTheme.secondary }]}>{kindLabel(range.kind)}</Text><Text style={[styles.detailName, { color: readingTheme.text }]}>{category?.name ?? '已删除的项目'}</Text><Text style={[styles.detailDates, { color: readingTheme.secondary }]}>{formatRange(range.startDate, range.endDate)}</Text>{range.note ? <Text style={[styles.detailNote, { color: readingTheme.text }]}>{range.note}</Text> : null}</View><View style={styles.detailActions}><Pressable onPress={() => openEdit(range)}><Text style={styles.detailEdit}>编辑</Text></Pressable><Pressable onPress={() => { setDeleteNotice(null); setDeleteCandidate(range); }}><Text style={styles.detailDelete}>删除</Text></Pressable></View></View>}) : <Text style={[styles.emptyDetail, { color: readingTheme.secondary }]}>这一格没有地点或阶段记录。</Text>}{settings.unit === 'day' && detail.startDate <= today ? <PrimaryButton onPress={() => openCreate(settings.colorMode, detail.startDate)} style={styles.sheetPrimary}><ButtonLabel>记录这一天</ButtonLabel></PrimaryButton> : null}</> : null}
      </View>
    </CenteredPanel>

    <CenteredPanel resetKey={managerCategory ? `manager-${managerCategory.id}` : `manager-settings-${settings.originDate}`} visible={managerVisible} onClose={() => { if (saving) return; setManagerVisible(false); setManagerCategory(null); setManagerNotice(null); }} backgroundColor={readingTheme.background} closeColor={readingTheme.secondary} contentContainerStyle={styles.dialogContent}>
      <Text style={[styles.sheetTitle, styles.formSheetTitle, { color: readingTheme.text }]}>{managerCategory ? `编辑${kindLabel(managerCategory.kind)}` : '时光像素设置'}</Text>
      {managerNotice ? <InlineNoticeCard notice={managerNotice} backgroundColor={readingTheme.surface} textColor={readingTheme.text} secondaryColor={readingTheme.secondary} /> : null}
      {managerCategory ? <><Text style={[styles.formLabel, styles.firstFormLabel, { color: readingTheme.secondary }]}>名称</Text><TextInput value={managerName} onChangeText={setManagerName} maxLength={30} style={[styles.input, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} /><TimePixelColorPicker value={managerColor} onChange={setManagerColor} categories={snapshot.categories} kind={managerCategory.kind} categoryId={managerCategory.id} name={managerName} /><PrimaryButton disabled={saving} onPress={() => void saveManager()} style={styles.sheetPrimary}><ButtonLabel>保存名称和颜色</ButtonLabel></PrimaryButton><Pressable onPress={() => { setManagerCategory(null); setManagerNotice(null); }} style={styles.sheetCancel}><Text style={[styles.sheetCancelText, { color: readingTheme.secondary }]}>返回设置</Text></Pressable></> : <>{(['location', 'stage'] as TimePixelKind[]).map((kind) => <View key={kind}><Text style={[styles.managerSection, { color: readingTheme.text }]}>{kind === 'location' ? '地点颜色' : '人生阶段颜色'}</Text>{snapshot.categories.filter((item) => item.kind === kind).length ? snapshot.categories.filter((item) => item.kind === kind).map((category) => <Pressable key={category.id} onPress={() => openManagerCategory(category)} style={[styles.managerRow, { borderBottomColor: readingTheme.border }]}><View style={[styles.managerSwatch, { backgroundColor: categoryColor(category.colorToken) }]} /><Text style={[styles.managerName, { color: readingTheme.text }]}>{category.name}</Text><Text style={[styles.managerAction, { color: readingTheme.secondary }]}>编辑 ›</Text></Pressable>) : <Text style={[styles.managerEmpty, { color: readingTheme.secondary }]}>还没有记录</Text>}</View>)}</>}
    </CenteredPanel>
  </SafeAreaView>;
}

function PageHeader({ title, right }: { title: string; right?: ReactNode }) {
  const { readingTheme } = useAppPreferences();
  return <View style={[styles.header, { borderBottomColor: readingTheme.border }]}><Pressable accessibilityLabel="返回" hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable><Text style={[styles.headerTitle, { color: readingTheme.text }]}>{title}</Text><View style={styles.headerRight}>{right}</View></View>;
}

function CenteredPanel({ visible, onClose, backgroundColor, closeColor, resetKey, contentContainerStyle, scrollEnabled = true, children }: { visible: boolean; onClose: () => void; backgroundColor: string; closeColor: string; resetKey: string; contentContainerStyle?: StyleProp<ViewStyle>; scrollEnabled?: boolean; children: ReactNode }) {
  const { height } = useWindowDimensions();
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.dialogKeyboard}>
      <Pressable accessible={false} onPress={onClose} style={styles.dialogOverlay}>
        <Pressable accessibilityViewIsModal onPress={(event) => event.stopPropagation()} style={[styles.dialogCard, { backgroundColor, maxHeight: Math.max(1, Math.min(680, height - spacing.xxl * 2)) }]}>
          <Pressable accessibilityLabel="关闭弹窗" hitSlop={10} onPress={onClose} style={styles.dialogClose}><Text style={[styles.dialogCloseText, { color: closeColor }]}>×</Text></Pressable>
          <ScrollView key={resetKey} bounces={false} keyboardShouldPersistTaps="handled" scrollEnabled={scrollEnabled} showsVerticalScrollIndicator={false} contentContainerStyle={contentContainerStyle}>{children}</ScrollView>
        </Pressable>
      </Pressable>
    </KeyboardAvoidingView>
  </Modal>;
}

function DateField({ label, value, onChange, minimumDate, maximumDate, backgroundColor, textColor, secondaryColor }: { label: string; value: string; onChange: (value: string) => void; minimumDate?: string; maximumDate?: string; backgroundColor: string; textColor: string; secondaryColor: string }) {
  const [visible, setVisible] = useState(false);
  function changed(event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS !== 'ios' || event.type === 'dismissed') setVisible(false);
    if (selected && event.type !== 'dismissed') onChange(dateKey(selected));
  }
  return <View style={styles.dateField}>{label ? <Text style={[styles.formLabel, { color: secondaryColor }]}>{label}</Text> : null}{Platform.OS === 'web' ? <TextInput value={value} onChangeText={onChange} placeholder="YYYY-MM-DD" placeholderTextColor={secondaryColor} style={[styles.input, { backgroundColor, color: textColor }]} /> : <><Pressable onPress={() => setVisible(true)} style={[styles.dateButton, { backgroundColor }]}><Text style={[styles.dateButtonText, { color: textColor }]}>{formatDate(value)}</Text><Text style={styles.dateButtonAction}>选择</Text></Pressable>{visible ? <DateTimePicker value={new Date(`${value}T12:00:00`)} mode="date" minimumDate={minimumDate ? new Date(`${minimumDate}T12:00:00`) : undefined} maximumDate={maximumDate ? new Date(`${maximumDate}T12:00:00`) : undefined} onChange={changed} /> : null}</>}</View>;
}

function YearWheelPicker({ value, onChange, minimumYear, maximumYear, surfaceColor, textColor, secondaryColor, includePresent = false }: { includePresent?: boolean; value: number; onChange: (year: number) => void; minimumYear: number; maximumYear: number; surfaceColor: string; textColor: string; secondaryColor: string }) {
  const scrollRef = useRef<ScrollView>(null);
  const positioned = useRef(false);
  const years = useMemo(() => [...(includePresent ? [maximumYear + 1] : []), ...Array.from({ length: maximumYear - minimumYear + 1 }, (_, index) => maximumYear - index)], [includePresent, maximumYear, minimumYear]);
  const selectedIndex = Math.max(0, years.indexOf(value));
  function scrollToIndex(index: number, animated: boolean) {
    scrollRef.current?.scrollTo({ y: index * YEAR_WHEEL_ITEM_HEIGHT, animated });
  }
  function updateFromOffset(offset: number) {
    const index = Math.max(0, Math.min(years.length - 1, Math.round(offset / YEAR_WHEEL_ITEM_HEIGHT)));
    if (years[index] !== value) onChange(years[index]);
  }
  return <View style={[styles.yearWheel, { backgroundColor: surfaceColor }]}>
    <View pointerEvents="none" style={styles.yearWheelSelection} />
    <ScrollView
      ref={scrollRef}
      nestedScrollEnabled
      bounces={false}
      decelerationRate="fast"
      snapToInterval={YEAR_WHEEL_ITEM_HEIGHT}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onLayout={() => { if (!positioned.current) requestAnimationFrame(() => { scrollToIndex(selectedIndex, false); positioned.current = true; }); }}
      onScroll={(event) => { if (positioned.current) updateFromOffset(event.nativeEvent.contentOffset.y); }}
      contentContainerStyle={styles.yearWheelContent}
    >
      {years.map((year, index) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: value === year }} key={year} onPress={() => scrollToIndex(index, true)} style={styles.yearWheelItem}><Text style={[styles.yearWheelText, { color: value === year ? textColor : secondaryColor }, value === year && styles.yearWheelTextActive]}>{year > maximumYear ? '至今' : `${year}年`}</Text></Pressable>)}
    </ScrollView>
  </View>;
}

function InlineNoticeCard({ notice, backgroundColor, textColor, secondaryColor }: { notice: InlineNotice; backgroundColor: string; textColor: string; secondaryColor: string }) {
  return <View accessibilityRole="alert" style={[styles.inlineNotice, { backgroundColor }]}><Text style={[styles.inlineNoticeTitle, { color: textColor }]}>{notice.title}</Text><Text style={[styles.inlineNoticeMessage, { color: secondaryColor }]}>{notice.message}</Text></View>;
}

function useYearSwipeHandlers(enabled: boolean, onChangeYear: (distance: number) => void) {
  return useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => enabled && Math.abs(gesture.dx) > 24 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
    onPanResponderRelease: (_event, gesture) => {
      if (enabled && Math.abs(gesture.dx) > 60 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2) onChangeYear(gesture.dx);
    },
    onPanResponderTerminationRequest: () => true,
  }).panHandlers, [enabled, onChangeYear]);
}

function YearSwipeRow({ panHandlers, style, children }: { panHandlers: ReturnType<typeof PanResponder.create>['panHandlers']; style: StyleProp<ViewStyle>; children: ReactNode }) {
  return <View {...panHandlers} style={style}>{children}</View>;
}

function PixelCell({ group, unit, categoryById, categoryOrder, focusedCategory, readingBorder, surfaceMuted, width, selected, onPress }: { group: PixelGroup; unit: TimePixelUnit; categoryById: ReadonlyMap<string, TimePixelCategory>; categoryOrder: ReadonlyMap<string, number>; focusedCategory: TimePixelCategory | null; readingBorder: string; surfaceMuted: string; width: number; selected: boolean; onPress: () => void }) {
  const knownCounts = Array.from(group.counts.entries()).flatMap(([categoryId, count]) => {
    const category = categoryById.get(categoryId);
    return category && count > 0 ? [{ category, count }] : [];
  }).sort((left, right) => (categoryOrder.get(left.category.id) ?? Number.MAX_SAFE_INTEGER) - (categoryOrder.get(right.category.id) ?? Number.MAX_SAFE_INTEGER));
  const unknown = group.counts.get('__unknown') ?? 0;
  const future = group.counts.get('__future') ?? 0;
  const label = labelForPixelGroup(group, unit);
  const isMonthMarker = unit === 'day' && label !== '';
  const firstCategory = knownCounts[0]?.category;
  const monthTextColor = firstCategory && (!focusedCategory || focusedCategory.id === firstCategory.id)
    ? timePixelTextColor(firstCategory.colorToken)
    : colors.primary;
  return <Pressable accessibilityLabel={`${formatRange(group.startDate, group.endDate)}${group.hasNote ? '，包含备注' : ''}，点击查看详情`} onPress={onPress} style={[styles.pixelPressable, { width }, selected && styles.pixelSelected]}>
    <View style={[styles.pixel, { width, height: unit === 'day' ? width : Math.max(38, width * 0.72), backgroundColor: surfaceMuted }]}>
      <View style={styles.pixelSegments}>{knownCounts.map(({ category, count }) => <View key={category.id} style={{ flex: count, backgroundColor: categoryColor(category.colorToken), opacity: focusedCategory && focusedCategory.id !== category.id ? 0.35 : 1 }} />)}{unknown ? <View style={{ flex: unknown, backgroundColor: readingBorder }} /> : null}{future ? <View style={{ flex: future, backgroundColor: surfaceMuted }} /> : null}</View>
      {future === group.totalDays ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderWidth: StyleSheet.hairlineWidth, borderColor: readingBorder, borderRadius: 3 }]} /> : null}
      {label ? <View pointerEvents="none" style={styles.pixelLabelContainer}><Text allowFontScaling={!isMonthMarker} style={[styles.pixelLabel, isMonthMarker && styles.monthPixelLabel, isMonthMarker && { color: monthTextColor }, isMonthMarker && monthTextColor !== '#FFFFFF' && styles.pixelLabelWithoutShadow]}>{label}</Text></View> : null}
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  filterScroll: { flex: 1, minWidth: 0 },
  rangeWheels: { flexDirection: 'row', gap: spacing.md }, rangeWheelColumn: { flex: 1, minWidth: 0 }, wheelCaption: { fontSize: 11, textAlign: 'center', marginBottom: spacing.sm },
  yearNavigation: { flexDirection: 'row', alignItems: 'center' }, yearArrow: { minWidth: 32, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  recordMode: { marginTop: spacing.md, marginBottom: 0 },
  confirmationCopy: { fontSize: 12, lineHeight: 22 },
  pageNotice: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginHorizontal: spacing.md, marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.md }, pageNoticeText: { flex: 1, fontSize: 10, lineHeight: 16 }, pageNoticeAction: { color: colors.primary, fontSize: 10, fontWeight: '700' },
  inlineNotice: { marginBottom: spacing.md, padding: spacing.md, borderRadius: radii.md }, inlineNoticeTitle: { fontSize: 11, fontWeight: '700' }, inlineNoticeMessage: { marginTop: 3, fontSize: 10, lineHeight: 16 }, inlineError: { marginTop: spacing.md, color: colors.danger, fontSize: 10, lineHeight: 16, textAlign: 'center' },
  dialogKeyboard: { flex: 1 }, dialogOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.overlay }, dialogCard: { width: '100%', maxWidth: 440, overflow: 'hidden', borderRadius: radii.lg, elevation: 14, shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } }, dialogContent: { paddingHorizontal: spacing.xl, paddingTop: spacing.xxl, paddingBottom: spacing.xl }, dialogClose: { position: 'absolute', zIndex: 2, top: spacing.sm, right: spacing.sm, width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill }, dialogCloseText: { fontSize: 24, lineHeight: 28, fontWeight: '300' },
  yearHeader: { minHeight: 40, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth },
  yearTitle: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '600' },
  yearAction: { minHeight: 36, paddingLeft: spacing.md, justifyContent: 'center' },
  returnButton: { minHeight: 36, justifyContent: 'center', marginBottom: spacing.xs },
  returnText: { fontSize: 11, color: colors.primary, fontWeight: '600' },
  drillRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  drillButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md },
  safe: { flex: 1 }, loader: { marginTop: 120 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth }, back: { color: colors.primary, fontSize: 13 }, headerTitle: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, headerRight: { width: 42, alignItems: 'flex-end' },
  failure: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl }, failureTitle: { fontFamily: fonts.serif, fontSize: 17 }, failureText: { fontSize: 11, lineHeight: 18, textAlign: 'center' },

  list: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: 44 }, controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }, rangeButton: { minHeight: 34, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, borderRadius: radii.pill }, rangeButtonText: { color: colors.primary, fontSize: 11, fontWeight: '700' }, chevron: { width: 6, height: 6, marginTop: -3, marginRight: 2, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: colors.primary, transform: [{ rotate: '45deg' }] }, segmented: { flexDirection: 'row', padding: 2, borderRadius: radii.pill }, segment: { minWidth: 38, minHeight: 30, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill }, segmentActive: { backgroundColor: colors.primary }, segmentText: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' }, segmentTextActive: { color: '#FFFFFF', fontWeight: '700' },
  modeRow: { flexDirection: 'row', marginTop: spacing.md, marginBottom: spacing.xs }, modeButton: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2 }, modeText: { fontSize: 12, fontWeight: '700' }, filterLine: { height: 40, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }, filterRow: { alignItems: 'center', gap: spacing.xs }, filterChip: { height: buttonMetrics.compactHeight, maxWidth: 150, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, borderRadius: radii.pill }, filterText: { color: colors.textSecondary, fontSize: 10 }, filterTextActive: { color: colors.primary, fontWeight: '700' }, swatch: { width: 9, height: 9, borderRadius: 3 }, manageButton: { width: buttonMetrics.iconSize, height: buttonMetrics.iconSize, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill },
  pixelCard: { borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm }, summaryRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md }, summaryLabel: { fontSize: 10 }, summaryValue: { flexDirection: 'row', alignItems: 'baseline', gap: 5, marginTop: 0 }, summaryNumber: { fontFamily: fonts.serif, fontSize: 29, fontWeight: '600', lineHeight: 34 }, summaryUnit: { fontSize: 11 }, summaryMeta: { alignItems: 'flex-end', gap: 2, maxWidth: 156, marginTop: spacing.xs }, summaryMetaText: { fontSize: 9, textAlign: 'right' },
  pixelRow: { flexDirection: 'row', paddingHorizontal: spacing.md, backgroundColor: colors.surface }, pixelPressable: { paddingBottom: 3 }, pixel: { position: 'relative', overflow: 'hidden', borderRadius: 3 }, pixelSegments: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row' }, pixelLabelContainer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }, pixelLabel: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', textAlign: 'center', textShadowColor: '#00000070', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }, monthPixelLabel: { opacity: 0.65, fontSize: 8, fontWeight: '600', textShadowRadius: 0.5 }, pixelLabelWithoutShadow: { textShadowColor: 'transparent', textShadowRadius: 0 }, pixelSelected: { opacity: 0.56 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm, backgroundColor: colors.surface, borderBottomLeftRadius: radii.lg, borderBottomRightRadius: radii.lg }, axisText: { fontSize: 8 }, legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingTop: spacing.lg }, legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 }, legendText: { fontSize: 9 }, addButton: { marginTop: spacing.lg }, emptyPixels: { padding: spacing.xl },
  sheetTitle: { marginBottom: spacing.lg, fontFamily: fonts.serif, fontSize: 18, fontWeight: '600', textAlign: 'center' }, formSheetTitle: { marginBottom: spacing.xs }, firstFormLabel: { marginTop: 0 }, rangeDialogContent: { paddingHorizontal: spacing.xl, paddingTop: spacing.xxl, paddingBottom: spacing.xl }, rangeModeSwitch: { flexDirection: 'row', padding: 3, borderRadius: radii.md, marginBottom: spacing.lg }, rangeModeChoice: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.sm }, rangeModeChoiceActive: { backgroundColor: colors.primary }, rangeModeChoiceText: { color: colors.textSecondary, fontSize: 11 }, rangeModeChoiceTextActive: { color: '#FFFFFF', fontWeight: '700' }, yearWheel: { height: YEAR_WHEEL_ITEM_HEIGHT * 5, overflow: 'hidden', borderRadius: radii.md }, yearWheelContent: { paddingVertical: YEAR_WHEEL_ITEM_HEIGHT * 2 }, yearWheelSelection: { position: 'absolute', zIndex: 0, top: YEAR_WHEEL_ITEM_HEIGHT * 2, left: spacing.sm, right: spacing.sm, height: YEAR_WHEEL_ITEM_HEIGHT, borderRadius: radii.md, backgroundColor: colors.primarySoft }, yearWheelItem: { zIndex: 1, height: YEAR_WHEEL_ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center' }, yearWheelText: { fontSize: 12 }, yearWheelTextActive: { color: colors.primary, fontSize: 16, fontWeight: '700' }, rangeApply: { marginTop: spacing.lg },
  detailRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radii.md }, detailBar: { width: 4, borderRadius: 2 }, detailCopy: { flex: 1 }, detailKind: { fontSize: 9 }, detailName: { marginTop: 2, fontSize: 13, fontWeight: '700' }, detailDates: { marginTop: 3, fontSize: 9 }, detailNote: { marginTop: spacing.sm, fontSize: 11, lineHeight: 17 }, detailActions: { justifyContent: 'space-between', alignItems: 'flex-end' }, detailEdit: { color: colors.primary, fontSize: 10, fontWeight: '700' }, detailDelete: { color: colors.danger, fontSize: 10 }, emptyDetail: { paddingVertical: spacing.xxl, fontSize: 11, textAlign: 'center' },
  formLabel: { marginTop: spacing.md, marginBottom: spacing.sm, fontSize: 10 }, categoryRow: { minHeight: buttonMetrics.minimumTouchTarget, alignItems: 'center', gap: spacing.xs }, categoryChoice: { gap: 6 }, categoryChoiceText: { fontSize: 10 }, newChoiceText: { color: colors.primary, fontSize: 10, fontWeight: '700' }, input: { minHeight: 46, paddingHorizontal: spacing.md, borderRadius: radii.md, fontSize: 13 }, noteInput: { minHeight: 92, paddingTop: spacing.md }, dateRow: { flexDirection: 'row', gap: spacing.md }, dateField: { flex: 1 }, dateButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, borderRadius: radii.md }, dateButtonText: { fontSize: 11 }, dateButtonAction: { color: colors.primary, fontSize: 9, fontWeight: '700' }, overwriteHint: { marginTop: spacing.md, fontSize: 9, lineHeight: 15 }, sheetPrimary: { marginTop: spacing.xl }, sheetCancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm }, sheetCancelText: { fontSize: 11 },
  disabledText: { opacity: 0.32 }, managerSection: { marginTop: spacing.xl, marginBottom: spacing.xs, fontFamily: fonts.serif, fontSize: 14, fontWeight: '600' }, managerRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth }, managerSwatch: { width: 18, height: 18, borderRadius: 6 }, managerName: { flex: 1, marginLeft: spacing.md, fontSize: 12 }, managerAction: { fontSize: 10 }, managerEmpty: { paddingVertical: spacing.md, fontSize: 10 },
});
