import { useCallback, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';

import { deleteSleepRecord, getSleepRecordBounds, listSleepRecords, saveSleepRecord, type SleepRecord } from '@/database/sleep-repository';
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
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
}

export default function SleepHistoryScreen() {
  const db = useSQLiteContext();
  const { readingTheme } = useAppPreferences();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [records, setRecords] = useState<SleepRecord[]>([]);
  const [bounds, setBounds] = useState<{ first_date: string | null; last_date: string | null }>({ first_date: null, last_date: null });
  const [pickerVisible, setPickerVisible] = useState(false);
  const [editing, setEditing] = useState<SleepRecord | null>(null);
  const [editValue, setEditValue] = useState<Date | null>(null);
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');
  const [pickerOpen, setPickerOpen] = useState(false);
  const loadSequence = useRef(0);
  const monthName = useMemo(() => new Date(year, month - 1, 1).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' }), [month, year]);
  const years = useMemo(() => {
    const firstYear = bounds.first_date ? Number(bounds.first_date.slice(0, 4)) : year;
    return Array.from({ length: Math.max(1, today.getFullYear() - firstYear + 1) }, (_, index) => today.getFullYear() - index);
  }, [bounds.first_date, today, year]);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const [items, nextBounds] = await Promise.all([
        listSleepRecords(db, monthStart(year, month), nextMonthStart(year, month)),
        getSleepRecordBounds(db),
      ]);
      if (sequence !== loadSequence.current) return;
      setRecords(items);
      setBounds(nextBounds ?? { first_date: null, last_date: null });
    } catch { if (sequence === loadSequence.current) await showAppDialog({ title: '历史记录暂时无法读取', message: '请稍后重试。' }); }
  }, [db, month, year]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function changeMonth(delta: number) {
    const next = new Date(year, month - 1 + delta, 1);
    if (next.getFullYear() > today.getFullYear()) return;
    setYear(next.getFullYear()); setMonth(next.getMonth() + 1);
  }

  function openEdit(record: SleepRecord) {
    setEditing(record); setEditValue(new Date(record.occurredAt)); setPickerMode('date'); setPickerOpen(false);
  }

  function onPickerChange(event: DateTimePickerEvent, selected?: Date) {
    if (event.type === 'dismissed') { setPickerOpen(false); return; }
    if (selected) setEditValue(selected);
    if (Platform.OS === 'android' && (event.type === 'set' || event.type === 'neutralButtonPressed')) setPickerOpen(false);
  }

  async function saveEdit() {
    if (!editing || !editValue) return;
    try {
      const updated = await saveSleepRecord(db, editValue.toISOString(), editing.id);
      setEditing(null); setPickerOpen(false);
      if (updated) {
        const [nextYear, nextMonth] = updated.nightDate.split('-').map(Number);
        if (nextYear !== year || nextMonth !== month) { setYear(nextYear); setMonth(nextMonth); }
        else await load();
      } else await load();
    } catch {
      await showAppDialog({ title: '修改没有保存', message: '同一晚只能有一条记录。请换一个日期或时间后重试。' });
    }
  }

  async function remove(record: SleepRecord) {
    const answer = await showAppDialog({ title: '删除这条睡眠记录？', message: `${nightLabel(record.nightDate)} · ${timeLabel(record.occurredAt)}`, actions: [{ label: '取消', value: 'cancel' }, { label: '删除', value: 'delete', tone: 'danger' }] });
    if (answer !== 'delete') return;
    try { await deleteSleepRecord(db, record.id); await load(); }
    catch { await showAppDialog({ title: '删除失败', message: '这条记录暂时无法删除，请稍后重试。' }); }
  }

  return <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => router.back()} style={styles.back}><Text style={[styles.backText, { color: readingTheme.text }]}>‹</Text></Pressable>
      <Text style={[styles.headerTitle, { color: readingTheme.text }]}>睡眠历史</Text><View style={styles.headerRight} />
    </View>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.monthNav}>
        <Pressable accessibilityLabel="上一个月" onPress={() => changeMonth(-1)} hitSlop={10} style={[styles.arrowButton, { backgroundColor: colors.surfaceMuted }]}><Text style={styles.arrowText}>‹</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => setPickerVisible(true)} style={styles.monthTitleButton}><Text style={[styles.monthTitle, { color: readingTheme.text }]}>{monthName}</Text><SymbolView name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }} size={14} tintColor={colors.primary} /></Pressable>
        <Pressable accessibilityLabel="下一个月" disabled={year === today.getFullYear() && month === today.getMonth() + 1} onPress={() => changeMonth(1)} hitSlop={10} style={[styles.arrowButton, { backgroundColor: colors.surfaceMuted }, year === today.getFullYear() && month === today.getMonth() + 1 && styles.disabled]}><Text style={styles.arrowText}>›</Text></Pressable>
      </View>
      <View style={styles.monthSummary}><Text style={[styles.summaryCount, { color: readingTheme.text }]}>{records.length}</Text><Text style={[styles.summaryLabel, { color: readingTheme.secondary }]}>晚有记录</Text><Text style={[styles.summaryAside, { color: readingTheme.secondary }]}>本月</Text></View>
      {records.length ? <View style={[styles.recordList, { backgroundColor: readingTheme.surface }]}>
        {records.map((record, index) => <View key={record.id} style={[styles.recordRow, index > 0 && { borderTopColor: readingTheme.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
          <View style={styles.recordGlyph}><SymbolView name={{ ios: 'moon.fill', android: 'bedtime', web: 'bedtime' }} size={17} tintColor={colors.primary} /></View>
          <View style={styles.recordInfo}><Text style={[styles.recordDate, { color: readingTheme.text }]}>{nightLabel(record.nightDate)}</Text><Text style={[styles.recordMeta, { color: readingTheme.secondary }]}>入睡</Text></View>
          <Text style={[styles.recordTime, { color: readingTheme.text }]}>{timeLabel(record.occurredAt)}</Text>
          <Pressable accessibilityLabel={`修改 ${nightLabel(record.nightDate)} 的记录`} onPress={() => openEdit(record)} hitSlop={9} style={styles.action}><SymbolView name={{ ios: 'pencil', android: 'edit', web: 'edit' }} size={16} tintColor={colors.primary} /></Pressable>
          <Pressable accessibilityLabel={`删除 ${nightLabel(record.nightDate)} 的记录`} onPress={() => void remove(record)} hitSlop={9} style={styles.action}><SymbolView name={{ ios: 'trash', android: 'delete', web: 'delete' }} size={17} tintColor={readingTheme.secondary} /></Pressable>
        </View>)}
      </View> : <View style={[styles.empty, { backgroundColor: colors.surfaceMuted }]}><SymbolView name={{ ios: 'moon', android: 'bedtime', web: 'bedtime' }} size={25} tintColor={colors.primary} /><Text style={[styles.emptyTitle, { color: readingTheme.text }]}>这个月还没有记录</Text><Text style={[styles.emptyHint, { color: readingTheme.secondary }]}>记录会一直保存在对应月份里。</Text></View>}
      <Text style={[styles.footnote, { color: readingTheme.secondary }]}>凌晨 0:00 至 11:59 的记录，会归到前一晚。</Text>
    </ScrollView>

    <Modal transparent animationType="fade" visible={pickerVisible} onRequestClose={() => setPickerVisible(false)}>
      <Pressable style={styles.overlay} onPress={() => setPickerVisible(false)}>
        <Pressable style={[styles.pickerCard, { backgroundColor: readingTheme.surface }]} onPress={(event) => event.stopPropagation()}>
          <Text style={[styles.pickerTitle, { color: readingTheme.text }]}>选择年月</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.yearStrip}>
            {years.map((item) => <Pressable key={item} onPress={() => setYear(item)} style={[styles.yearChip, year === item && styles.chipActive]}><Text style={[styles.yearText, { color: year === item ? '#FFF' : readingTheme.text }]}>{item}</Text></Pressable>)}
          </ScrollView>
          <View style={styles.monthGrid}>{MONTHS.map((item) => {
            const future = year === today.getFullYear() && item > today.getMonth() + 1;
            return <Pressable key={item} disabled={future} onPress={() => { setMonth(item); setPickerVisible(false); }} style={[styles.monthChip, month === item && year === Number(monthName.slice(0, 4)) && styles.chipActive, future && styles.disabled]}><Text style={[styles.monthText, { color: month === item && year === Number(monthName.slice(0, 4)) ? '#FFF' : readingTheme.text }]}>{item}月</Text></Pressable>;
          })}</View>
          <Pressable onPress={() => setPickerVisible(false)} style={styles.cancelButton}><Text style={[styles.cancelText, { color: readingTheme.secondary }]}>取消</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>

    <Modal transparent animationType="slide" visible={Boolean(editing)} onRequestClose={() => { setEditing(null); setPickerOpen(false); }}>
      <Pressable style={styles.overlay} onPress={() => { setEditing(null); setPickerOpen(false); }}>
        <Pressable style={[styles.editorCard, { backgroundColor: readingTheme.surface }]} onPress={(event) => event.stopPropagation()}>
          <Text style={[styles.editorTitle, { color: readingTheme.text }]}>修改睡眠时间</Text>
          <Text style={[styles.editorHint, { color: readingTheme.secondary }]}>修改后会自动重新归到对应的睡眠夜</Text>
          <View style={styles.editActions}>
            <Pressable onPress={() => { setPickerMode('date'); setPickerOpen(true); }} style={[styles.editField, { backgroundColor: colors.surfaceMuted }]}><Text style={styles.fieldLabel}>日期</Text><Text style={[styles.fieldValue, { color: readingTheme.text }]}>{editValue?.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</Text></Pressable>
            <Pressable onPress={() => { setPickerMode('time'); setPickerOpen(true); }} style={[styles.editField, { backgroundColor: colors.surfaceMuted }]}><Text style={styles.fieldLabel}>时间</Text><Text style={[styles.fieldValue, { color: readingTheme.text }]}>{editValue?.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</Text></Pressable>
          </View>
          {pickerOpen && editValue ? <View style={styles.pickerControl}><DateTimePicker value={editValue} mode={pickerMode} display={Platform.OS === 'ios' ? 'spinner' : 'default'} maximumDate={new Date()} onChange={onPickerChange} /></View> : null}
          <View style={styles.editorButtons}><Pressable onPress={() => { setEditing(null); setPickerOpen(false); }} style={styles.cancelAction}><Text style={[styles.cancelText, { color: readingTheme.secondary }]}>取消</Text></Pressable><Pressable onPress={() => void saveEdit()} style={styles.saveAction}><Text style={styles.saveText}>保存修改</Text></Pressable></View>
        </Pressable>
      </Pressable>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, header: { height: 52, paddingHorizontal: spacing.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, back: { width: 44, height: 44, justifyContent: 'center' }, backText: { fontSize: 38, lineHeight: 42, fontWeight: '300' }, headerTitle: { fontFamily: fonts.serif, fontSize: 19, fontWeight: '600' }, headerRight: { width: 44 },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.xxl, paddingBottom: 36 }, monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, arrowButton: { width: 40, height: 40, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' }, arrowText: { color: colors.primary, fontSize: 27, lineHeight: 30 }, monthTitleButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md }, monthTitle: { fontFamily: fonts.serif, fontSize: 22, fontWeight: '600' }, disabled: { opacity: 0.35 }, monthSummary: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: spacing.xl, marginBottom: spacing.lg }, summaryCount: { fontFamily: fonts.serif, fontSize: 28, fontWeight: '600' }, summaryLabel: { fontSize: 13 }, summaryAside: { marginLeft: 'auto', fontSize: 12 },
  recordList: { paddingHorizontal: spacing.lg, borderRadius: radii.lg }, recordRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, recordGlyph: { width: 38, height: 38, borderRadius: radii.pill, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }, recordInfo: { flex: 1 }, recordDate: { fontFamily: fonts.serif, fontSize: 15 }, recordMeta: { marginTop: 4, fontSize: 11 }, recordTime: { fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] }, action: { minWidth: 30, height: 42, alignItems: 'center', justifyContent: 'center' }, empty: { alignItems: 'center', padding: spacing.xxl, borderRadius: radii.lg }, emptyTitle: { marginTop: spacing.md, fontFamily: fonts.serif, fontSize: 16 }, emptyHint: { marginTop: spacing.sm, fontSize: 12 }, footnote: { marginTop: spacing.lg, fontSize: 11, lineHeight: 18 },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl, backgroundColor: colors.overlay }, pickerCard: { width: '100%', maxWidth: 390, borderRadius: radii.lg, padding: spacing.xl }, pickerTitle: { textAlign: 'center', fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' }, yearStrip: { gap: spacing.sm, paddingVertical: spacing.xl }, yearChip: { minWidth: 62, minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted }, chipActive: { backgroundColor: colors.primary }, yearText: { fontSize: 12, fontWeight: '600' }, monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'space-between' }, monthChip: { width: '22%', minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.surfaceMuted }, monthText: { fontSize: 12 }, cancelButton: { minHeight: 44, marginTop: spacing.md, alignItems: 'center', justifyContent: 'center' }, cancelText: { fontSize: 14 },
  editorCard: { width: '100%', maxWidth: 430, borderRadius: radii.lg, padding: spacing.xl }, editorTitle: { fontFamily: fonts.serif, fontSize: 20, fontWeight: '600' }, editorHint: { marginTop: spacing.xs, fontSize: 12 }, editActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl }, editField: { flex: 1, minHeight: 70, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radii.md }, fieldLabel: { color: colors.primary, fontSize: 11 }, fieldValue: { marginTop: 5, fontSize: 15, fontWeight: '600' }, pickerControl: { alignItems: 'center', marginTop: spacing.md }, editorButtons: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg }, cancelAction: { minHeight: 44, paddingHorizontal: spacing.md, justifyContent: 'center' }, saveAction: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radii.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, saveText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
});
