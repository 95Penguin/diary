import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createSleepRecord, deleteSleepRecord, getSleepRecordBounds, getSleepRecordMonthCounts, listSleepRecords, saveSleepRecord, sleepNightDate, type SleepRecord } from '@/database/sleep-repository';
import { showAppDialog } from '@/components/app-dialog-host';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { useAppPreferences } from '@/preferences/app-preferences';

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
const pad = (value: number) => String(value).padStart(2, '0');
const monthKey = (year: number, month: number) => `${year}-${pad(month)}`;
const monthStart = (year: number, month: number) => `${monthKey(year, month)}-01`;
const nextMonthStart = (year: number, month: number) => month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`;
function timeLabel(value: string) { return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }); }
function nightLabel(value: string) {
  const [, month, day] = value.split('-');
  return `${Number(month)}月${Number(day)}日`;
}
function fullNightLabel(value: string) {
  const [year, month, day] = value.split('-');
  return `${year}年${Number(month)}月${Number(day)}日夜`;
}

export default function SleepHistoryScreen() {
  const db = useSQLiteContext();
  const params = useLocalSearchParams<{ year?: string; month?: string; editId?: string }>();
  const { readingTheme } = useAppPreferences();
  const [today] = useState(() => new Date());
  const [year, setYear] = useState(() => Number(params.year) || today.getFullYear());
  const [month, setMonth] = useState(() => Number(params.month) || today.getMonth() + 1);
  const [records, setRecords] = useState<SleepRecord[]>([]);
  const [bounds, setBounds] = useState<{ first_date: string | null; last_date: string | null }>({ first_date: null, last_date: null });
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerYear, setPickerYear] = useState(year);
  const [pickerMonth, setPickerMonth] = useState(month);
  const [monthCounts, setMonthCounts] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<SleepRecord | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editValue, setEditValue] = useState<Date | null>(null);
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');
  const [pickerOpen, setPickerOpen] = useState(false);
  const loadSequence = useRef(0);
  const autoEditHandled = useRef(false);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  function showSaveNotice(message: string) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setSaveNotice(message);
    noticeTimer.current = setTimeout(() => { setSaveNotice(''); noticeTimer.current = null; }, 3500);
  }
  const monthName = useMemo(() => new Date(year, month - 1, 1).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' }), [month, year]);
  const years = useMemo(() => {
    const firstYear = bounds.first_date ? Number(bounds.first_date.slice(0, 4)) : year;
    return Array.from({ length: Math.max(1, today.getFullYear() - firstYear + 1) }, (_, index) => today.getFullYear() - index);
  }, [bounds.first_date, today, year]);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const [items, nextBounds, nextMonthCounts] = await Promise.all([
        listSleepRecords(db, monthStart(year, month), nextMonthStart(year, month)),
        getSleepRecordBounds(db),
        getSleepRecordMonthCounts(db),
      ]);
      if (sequence !== loadSequence.current) return;
      setRecords(items);
      setBounds(nextBounds ?? { first_date: null, last_date: null });
      setMonthCounts(nextMonthCounts);
    } catch { if (sequence === loadSequence.current) await showAppDialog({ title: '历史记录暂时无法读取', message: '请稍后重试。' }); }
  }, [db, month, year]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useEffect(() => {
    if (autoEditHandled.current || !params.editId || !records.length) return;
    const record = records.find((item) => String(item.id) === params.editId);
    if (record) { autoEditHandled.current = true; openEdit(record); }
  }, [params.editId, records]);

  function changeMonth(delta: number) {
    const next = new Date(year, month - 1 + delta, 1);
    if (next.getFullYear() > today.getFullYear()) return;
    setYear(next.getFullYear()); setMonth(next.getMonth() + 1);
  }

  function openMonthPicker() { setPickerYear(year); setPickerMonth(month); setPickerVisible(true); }
  function confirmMonthPicker() { setYear(pickerYear); setMonth(pickerMonth); setPickerVisible(false); }

  function openEdit(record: SleepRecord) {
    setEditing(record); setEditValue(new Date(record.occurredAt)); setPickerMode('date'); setPickerOpen(false); setEditorVisible(true);
  }

  function openAdd() {
    const lastDay = new Date(year, month, 0).getDate();
    const currentMonth = year === today.getFullYear() && month === today.getMonth() + 1;
    setEditing(null); setEditValue(currentMonth ? today : new Date(year, month - 1, lastDay, 23, 0)); setPickerMode('date'); setPickerOpen(false); setEditorVisible(true);
  }

  function onPickerChange(event: DateTimePickerEvent, selected?: Date) {
    if (event.type === 'dismissed') { setPickerOpen(false); return; }
    if (selected) setEditValue(selected);
    if (Platform.OS === 'android' && (event.type === 'set' || event.type === 'neutralButtonPressed')) setPickerOpen(false);
  }

  async function saveEdit() {
    if (!editValue || savingEdit) return;
    if (editValue.getTime() > Date.now()) { await showAppDialog({ title: '时间还没到', message: '请选择已经过去的时间。' }); return; }
    setSavingEdit(true);
    try {
      const updated = editing
        ? await saveSleepRecord(db, editValue.toISOString(), editing.id)
        : await createSleepRecord(db, editValue.toISOString());
      if (!updated) throw new Error('sleep-record-not-found');
      const notice = editing
        ? `${updated.nightDate === editing.nightDate ? '已更新' : '已移至'} ${fullNightLabel(updated.nightDate)}`
        : `已补记至 ${fullNightLabel(updated.nightDate)}`;
      setEditing(null); setPickerOpen(false); setEditorVisible(false);
      const [nextYear, nextMonth] = updated.nightDate.split('-').map(Number);
      if (nextYear !== year || nextMonth !== month) { setYear(nextYear); setMonth(nextMonth); }
      else await load();
      showSaveNotice(notice);
    } catch {
      await showAppDialog({ title: editing ? '修改没有保存' : '补记没有保存', message: '这一晚可能已有记录，请长按原记录修改，或换一个日期后重试。' });
    } finally { setSavingEdit(false); }
  }

  async function remove(record: SleepRecord) {
    const answer = await showAppDialog({ title: '删除这条睡眠记录？', message: `${nightLabel(record.nightDate)} · ${timeLabel(record.occurredAt)}`, actions: [{ label: '取消', value: 'cancel' }, { label: '删除', value: 'delete', tone: 'danger' }] });
    if (answer !== 'delete') return;
    try { await deleteSleepRecord(db, record.id); await load(); }
    catch { await showAppDialog({ title: '删除失败', message: '这条记录暂时无法删除，请稍后重试。' }); }
  }

  async function manageRecord(record: SleepRecord) {
    const answer = await showAppDialog({ title: `${nightLabel(record.nightDate)} · ${timeLabel(record.occurredAt)}`, actions: [{ label: '编辑时间', value: 'edit' }, { label: '删除记录', value: 'delete', tone: 'danger' }] });
    if (answer === 'edit') openEdit(record);
    else if (answer === 'delete') await remove(record);
  }

  return <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="返回" hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable>
      <Text style={[styles.headerTitle, { color: readingTheme.text }]}>睡眠历史</Text><Pressable accessibilityRole="button" accessibilityLabel="补记睡眠时间" onPress={openAdd} style={styles.headerRight}><Text style={styles.addText}>补记</Text></Pressable>
    </View>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.monthNav}>
        <Pressable accessibilityLabel="上一个月" onPress={() => changeMonth(-1)} hitSlop={10} style={[styles.arrowButton, { backgroundColor: readingTheme.surface }]}><Text style={[styles.arrowText, { color: colors.primary }]}>‹</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`选择年月，当前${monthName}`} onPress={openMonthPicker} style={styles.monthTitleButton}><Text style={[styles.monthTitle, { color: readingTheme.text }]}>{monthName}</Text></Pressable>
        <Pressable accessibilityLabel="下一个月" disabled={year === today.getFullYear() && month === today.getMonth() + 1} onPress={() => changeMonth(1)} hitSlop={10} style={[styles.arrowButton, { backgroundColor: readingTheme.surface }, year === today.getFullYear() && month === today.getMonth() + 1 && styles.disabled]}><Text style={[styles.arrowText, { color: colors.primary }]}>›</Text></Pressable>
      </View>
      <View style={styles.monthSummary}><Text style={[styles.summaryCount, { color: readingTheme.text }]}>{records.length}</Text><Text style={[styles.summaryLabel, { color: readingTheme.secondary }]}>晚有记录</Text><Text style={[styles.summaryAside, { color: readingTheme.secondary }]}>本月</Text></View>
      {saveNotice ? <Text accessibilityLiveRegion="polite" style={styles.saveNotice}>{saveNotice}</Text> : null}
      {records.length ? <View style={[styles.recordList, { backgroundColor: readingTheme.surface }]}>
        {records.map((record, index) => <Pressable key={record.id} accessibilityRole="button" accessibilityLabel={`${nightLabel(record.nightDate)} ${timeLabel(record.occurredAt)}，长按编辑或删除`} onLongPress={() => void manageRecord(record)} delayLongPress={350} style={({ pressed }) => [styles.recordRow, index > 0 && { borderTopColor: readingTheme.border, borderTopWidth: StyleSheet.hairlineWidth }, pressed && styles.rowPressed]}>
          <View style={styles.recordInfo}><Text style={[styles.recordDate, { color: readingTheme.text }]}>{nightLabel(record.nightDate)}</Text></View>
          <Text style={[styles.recordTime, { color: readingTheme.text }]}>{timeLabel(record.occurredAt)}</Text>
        </Pressable>)}
      </View> : <View style={[styles.empty, { backgroundColor: readingTheme.surface }]}><SymbolView name={{ ios: 'moon', android: 'bedtime', web: 'bedtime' }} size={21} tintColor={colors.primary} /><Text style={[styles.emptyTitle, { color: readingTheme.secondary }]}>这个月还没有记录</Text></View>}
    </ScrollView>

    <Modal transparent animationType="fade" visible={pickerVisible} onRequestClose={() => setPickerVisible(false)}>
      <Pressable style={styles.overlay} onPress={() => setPickerVisible(false)}>
        <Pressable style={[styles.pickerCard, { backgroundColor: readingTheme.surface }]} onPress={(event) => event.stopPropagation()}>
          <Text style={[styles.pickerTitle, { color: readingTheme.text }]}>选择年月</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.yearStrip}>
            {years.map((item) => <Pressable key={item} onPress={() => { setPickerYear(item); if (item === today.getFullYear() && pickerMonth > today.getMonth() + 1) setPickerMonth(today.getMonth() + 1); }} style={[styles.yearChip, { backgroundColor: readingTheme.background }, pickerYear === item && styles.chipActive]}><Text style={[styles.yearText, { color: pickerYear === item ? '#FFF' : readingTheme.text }]}>{item}</Text></Pressable>)}
          </ScrollView>
          <View style={styles.monthGrid}>{MONTHS.map((item) => {
            const future = pickerYear === today.getFullYear() && item > today.getMonth() + 1;
            const selected = pickerMonth === item;
            const count = monthCounts[monthKey(pickerYear, item)] ?? 0;
            return <Pressable key={item} accessibilityRole="button" accessibilityLabel={`${pickerYear}年${item}月，${count}晚有记录`} disabled={future} onPress={() => setPickerMonth(item)} style={[styles.monthChip, { backgroundColor: readingTheme.background }, selected && styles.chipActive, future && styles.disabled]}><Text style={[styles.monthText, { color: selected ? '#FFF' : readingTheme.text }]}>{item}月</Text>{count ? <View style={[styles.monthDot, { backgroundColor: selected ? '#FFF' : colors.primary }]} /> : null}</Pressable>;
          })}</View>
          <View style={styles.pickerActions}><Pressable onPress={() => setPickerVisible(false)} style={styles.cancelButton}><Text style={[styles.cancelText, { color: readingTheme.secondary }]}>取消</Text></Pressable><Pressable onPress={confirmMonthPicker} style={styles.confirmButton}><Text style={styles.confirmText}>查看</Text></Pressable></View>
        </Pressable>
      </Pressable>
    </Modal>

    <Modal transparent animationType="slide" visible={editorVisible} onRequestClose={() => { setEditorVisible(false); setEditing(null); setPickerOpen(false); }}>
      <Pressable style={styles.overlay} onPress={() => { setEditorVisible(false); setEditing(null); setPickerOpen(false); }}>
        <Pressable style={[styles.editorCard, { backgroundColor: readingTheme.surface }]} onPress={(event) => event.stopPropagation()}>
          <Text style={[styles.editorTitle, { color: readingTheme.text }]}>{editing ? '修改睡眠时间' : '补记睡眠时间'}</Text>
          <View style={styles.editActions}>
            <Pressable onPress={() => { setPickerMode('date'); setPickerOpen(true); }} style={[styles.editField, { backgroundColor: readingTheme.background }]}><Text style={[styles.fieldLabel, { color: readingTheme.secondary }]}>日期</Text><Text style={[styles.fieldValue, { color: readingTheme.text }]}>{editValue?.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</Text></Pressable>
            <Pressable onPress={() => { setPickerMode('time'); setPickerOpen(true); }} style={[styles.editField, { backgroundColor: readingTheme.background }]}><Text style={[styles.fieldLabel, { color: readingTheme.secondary }]}>时间</Text><Text style={[styles.fieldValue, { color: readingTheme.text }]}>{editValue?.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</Text></Pressable>
          </View>
          {editValue ? <Text style={[styles.nightPreview, { color: readingTheme.secondary }]}>归入 {fullNightLabel(sleepNightDate(editValue))}</Text> : null}
          {pickerOpen && editValue ? <View style={styles.pickerControl}><DateTimePicker value={editValue} mode={pickerMode} display={Platform.OS === 'ios' ? 'spinner' : 'default'} maximumDate={new Date()} onChange={onPickerChange} /></View> : null}
          <View style={styles.editorButtons}><Pressable onPress={() => { setEditorVisible(false); setEditing(null); setPickerOpen(false); }} style={styles.cancelAction}><Text style={[styles.cancelText, { color: readingTheme.secondary }]}>取消</Text></Pressable><Pressable disabled={savingEdit} onPress={() => void saveEdit()} style={[styles.saveAction, savingEdit && styles.disabled]}><Text style={styles.saveText}>{editing ? '保存修改' : '保存补记'}</Text></Pressable></View>
        </Pressable>
      </Pressable>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, header: { height: 52, paddingHorizontal: spacing.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth }, back: { color: colors.primary, fontSize: 13 }, headerTitle: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, headerRight: { minWidth: 42, height: 42, justifyContent: 'center', alignItems: 'flex-end' }, addText: { color: colors.primary, fontSize: 12, fontWeight: '600' },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.xs, paddingBottom: 28 }, monthNav: { height: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, arrowButton: { width: 36, height: 36, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' }, arrowText: { fontSize: 24, lineHeight: 27 }, monthTitleButton: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md }, monthTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' }, disabled: { opacity: 0.35 }, monthSummary: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: 0, marginBottom: spacing.sm }, summaryCount: { fontFamily: fonts.serif, fontSize: 21, fontWeight: '600' }, summaryLabel: { fontSize: 12 }, summaryAside: { marginLeft: 'auto', fontSize: 11 },
  saveNotice: { marginBottom: spacing.xs, color: colors.primary, fontSize: 11, textAlign: 'center' },
  recordList: { paddingHorizontal: spacing.md, borderRadius: radii.lg }, recordRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, rowPressed: { opacity: 0.72 }, recordInfo: { flex: 1, minWidth: 0 }, recordDate: { fontFamily: fonts.serif, fontSize: 13 }, recordTime: { width: 48, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'], textAlign: 'right' }, empty: { alignItems: 'center', padding: spacing.lg, borderRadius: radii.lg }, emptyTitle: { marginTop: spacing.sm, fontSize: 13 },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl, backgroundColor: colors.overlay }, pickerCard: { width: '100%', maxWidth: 390, borderRadius: radii.lg, padding: spacing.lg }, pickerTitle: { textAlign: 'center', fontFamily: fonts.serif, fontSize: 16, fontWeight: '600' }, yearStrip: { gap: spacing.sm, paddingVertical: spacing.md }, yearChip: { minWidth: 58, minHeight: 34, paddingHorizontal: spacing.md, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' }, chipActive: { backgroundColor: colors.primary }, yearText: { fontSize: 11, fontWeight: '600' }, monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'space-between' }, monthChip: { width: '22%', minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md }, monthText: { fontSize: 11 }, monthDot: { position: 'absolute', bottom: 4, width: 4, height: 4, borderRadius: 2 }, pickerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm }, cancelButton: { minHeight: 40, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' }, cancelText: { fontSize: 12 }, confirmButton: { minHeight: 40, paddingHorizontal: spacing.lg, borderRadius: radii.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, confirmText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  editorCard: { width: '100%', maxWidth: 430, borderRadius: radii.lg, padding: spacing.lg }, editorTitle: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, editActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }, editField: { flex: 1, minHeight: 64, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radii.md }, fieldLabel: { fontSize: 10 }, fieldValue: { marginTop: 4, fontSize: 13, fontWeight: '600' }, nightPreview: { marginTop: spacing.sm, fontSize: 12 }, pickerControl: { alignItems: 'center', marginTop: spacing.md }, editorButtons: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.md, marginTop: spacing.md }, cancelAction: { minHeight: 42, paddingHorizontal: spacing.md, justifyContent: 'center' }, saveAction: { minHeight: 42, paddingHorizontal: spacing.lg, borderRadius: radii.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, saveText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
});
