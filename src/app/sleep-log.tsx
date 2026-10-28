import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { router, useFocusEffect, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { GlassView } from 'expo-glass-effect';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';

import { deleteSleepRecord, getLatestSleepRecords, getSleepRecordForNight, saveSleepRecord, sleepNightDate, type SleepRecord } from '@/database/sleep-repository';
import { showAppDialog } from '@/components/app-dialog-host';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { useAppPreferences } from '@/preferences/app-preferences';

function timeLabel(value: string) { return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }); }
function dateLabel(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
}
function nightLabel(value: string) { const [, month, day] = value.split('-'); return `${Number(month)}月${Number(day)}日`; }
function fullNightLabel(value: string) {
  const [year, month, day] = value.split('-');
  return `${year}年${Number(month)}月${Number(day)}日夜`;
}
function shadeCircle(surface: string) {
  if (surface === '#232B26') return surface;
  const amount = 0.1;
  const channels = [1, 3, 5].map((offset) => Math.round(
    parseInt(surface.slice(offset, offset + 2), 16) * (1 - amount)
    + parseInt(colors.primary.slice(offset, offset + 2), 16) * amount,
  ));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export default function SleepLogScreen() {
  const db = useSQLiteContext();
  const { readingTheme } = useAppPreferences();
  const [records, setRecords] = useState<SleepRecord[]>([]);
  const [tonight, setTonight] = useState<SleepRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const latestQueuedTap = useRef<string | null>(null);
  const loadSequence = useRef(0);
  const [undoRecord, setUndoRecord] = useState<{ saved: SleepRecord; previous: SleepRecord | null } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editing, setEditing] = useState<SleepRecord | null>(null);
  const [editValue, setEditValue] = useState<Date | null>(null);
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');
  const [hintVisible, setHintVisible] = useState(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintChecked = useRef(false);
  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  useEffect(() => {
    if (loading || !records.length || hintChecked.current) return;
    hintChecked.current = true;
    void db.getFirstAsync<{ value: string }>("SELECT value FROM kv_store WHERE key = 'sleep-long-press-hint-seen'").then((row) => {
      if (row) return;
      setHintVisible(true);
      void db.runAsync("INSERT OR REPLACE INTO kv_store (key, value) VALUES ('sleep-long-press-hint-seen', '1')").catch(() => {});
      hintTimer.current = setTimeout(() => { setHintVisible(false); hintTimer.current = null; }, 4500);
    }).catch(() => {});
  }, [db, loading, records.length]);

  function showSaveNotice(message: string) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setSaveNotice(message);
    noticeTimer.current = setTimeout(() => { setSaveNotice(''); noticeTimer.current = null; }, 3500);
  }

  function clearUndo() {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setUndoRecord(null);
  }

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      const [latest, current] = await Promise.all([
        getLatestSleepRecords(db, 7),
        getSleepRecordForNight(db, sleepNightDate(new Date())),
      ]);
      if (sequence === loadSequence.current) { setRecords(latest); setTonight(current); }
    } catch {
      if (sequence === loadSequence.current) await showAppDialog({ title: '暂时无法读取睡眠记录', message: '请稍后重新进入这个页面。' });
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [db]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function recordNow() {
    const tappedAt = new Date().toISOString();
    if (savingRef.current) {
      latestQueuedTap.current = tappedAt;
      return;
    }
    savingRef.current = true;
    setSaving(true);
    clearUndo();
    try {
      const previous = await getSleepRecordForNight(db, sleepNightDate(new Date(tappedAt)));
      let timeToSave: string | null = tappedAt;
      let saved: SleepRecord | null = null;
      while (timeToSave) {
        saved = await saveSleepRecord(db, timeToSave);
        const queuedTap = latestQueuedTap.current;
        latestQueuedTap.current = null;
        timeToSave = queuedTap;
      }
      setTonight(saved);
      savingRef.current = false;
      setSaving(false);
      await load();
      if (saved) {
        setUndoRecord({ saved, previous });
        undoTimer.current = setTimeout(() => { setUndoRecord(null); undoTimer.current = null; }, 6000);
      }
    } catch {
      await showAppDialog({ title: '记录没有保存', message: '请重试，或者稍后在历史记录中补记。' });
    } finally { latestQueuedTap.current = null; savingRef.current = false; setSaving(false); }
  }

  async function undoLastRecord() {
    if (!undoRecord || savingRef.current) return;
    const { saved, previous } = undoRecord;
    clearUndo();
    savingRef.current = true;
    setSaving(true);
    try {
      const current = await getSleepRecordForNight(db, saved.nightDate);
      if (!current || current.id !== saved.id || current.occurredAt !== saved.occurredAt) return;
      if (previous) await saveSleepRecord(db, previous.occurredAt, saved.id);
      else await deleteSleepRecord(db, saved.id);
      await load();
    } catch { await showAppDialog({ title: '撤销失败', message: '请长按最近记录手动修改。' }); }
    finally { savingRef.current = false; setSaving(false); }
  }

  function openEdit(record: SleepRecord) {
    setEditing(record);
    setEditValue(new Date(record.occurredAt));
    setPickerMode('date');
    setPickerOpen(false);
  }

  function closeEdit() { setEditing(null); setPickerOpen(false); }

  function onPickerChange(event: DateTimePickerEvent, selected?: Date) {
    if (event.type === 'dismissed') { setPickerOpen(false); return; }
    if (selected) setEditValue(selected);
    if (Platform.OS === 'android' && (event.type === 'set' || event.type === 'neutralButtonPressed')) setPickerOpen(false);
  }

  async function saveEdit() {
    if (!editing || !editValue || savingEdit) return;
    if (editValue.getTime() > Date.now()) { await showAppDialog({ title: '时间还没到', message: '请选择已经过去的时间。' }); return; }
    setSavingEdit(true);
    try {
      const updated = await saveSleepRecord(db, editValue.toISOString(), editing.id);
      if (!updated) throw new Error('sleep-record-not-found');
      clearUndo();
      closeEdit();
      await load();
      showSaveNotice(`${updated.nightDate === editing.nightDate ? '已更新' : '已移至'} ${fullNightLabel(updated.nightDate)}`);
    } catch {
      await showAppDialog({ title: '修改没有保存', message: '这一晚可能已有记录，请换一个日期或时间后重试。' });
    } finally { setSavingEdit(false); }
  }

  async function manageRecord(record: SleepRecord) {
    const answer = await showAppDialog({ title: `${nightLabel(record.nightDate)} · ${timeLabel(record.occurredAt)}`, actions: [{ label: '编辑时间', value: 'edit' }, { label: '删除记录', value: 'delete', tone: 'danger' }] });
    if (answer === 'edit') openEdit(record);
    else if (answer === 'delete') {
      const confirm = await showAppDialog({ title: '删除这条睡眠记录？', actions: [{ label: '取消', value: 'cancel' }, { label: '删除', value: 'delete', tone: 'danger' }] });
      if (confirm === 'delete') {
        try { await deleteSleepRecord(db, record.id); clearUndo(); await load(); }
        catch { await showAppDialog({ title: '删除失败', message: '这条记录暂时无法删除，请稍后重试。' }); }
      }
    }
  }

  return <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="返回" hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable>
      <Text style={[styles.headerTitle, { color: readingTheme.text }]}>睡眠记录</Text>
      <View style={styles.headerRight} />
    </View>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Pressable accessibilityRole="button" accessibilityLabel={tonight ? `更新入睡时间，当前记录 ${timeLabel(tonight.occurredAt)}` : '记录现在的入睡时间'} onPress={() => void recordNow()} style={({ pressed }) => [styles.circle, { backgroundColor: shadeCircle(readingTheme.surface), borderColor: readingTheme.border }, pressed && styles.circlePressed]}>
        {Platform.OS === 'ios' ? <GlassView pointerEvents="none" glassEffectStyle="regular" style={styles.glassLayer} /> : null}
        <View pointerEvents="none" style={[styles.glassShine, { borderColor: readingTheme.background }]} />
        <View style={[styles.moonMark, { backgroundColor: readingTheme.background }]}>
          {saving ? <ActivityIndicator color={colors.primary} size="small" /> : <SymbolView name={{ ios: 'moon.stars.fill', android: 'bedtime', web: 'bedtime' }} size={23} tintColor={colors.primary} />}
        </View>
        <Text style={[styles.circleTime, { color: readingTheme.text }]}>{saving ? '正在记录' : tonight ? timeLabel(tonight.occurredAt) : '记录入睡'}</Text>
      </Pressable>
      {undoRecord ? <View style={[styles.undoBar, { backgroundColor: readingTheme.surface, borderColor: readingTheme.border }]}><Text style={[styles.undoText, { color: readingTheme.text }]}>{`已记录 ${timeLabel(undoRecord.saved.occurredAt)}`}</Text><Pressable accessibilityRole="button" accessibilityLabel="撤销刚才的睡眠记录" onPress={() => void undoLastRecord()} style={styles.undoButton}><Text style={styles.undoButtonText}>撤销</Text></Pressable></View> : null}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: readingTheme.text }]}>最近记录</Text>
        <View style={styles.sectionActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="查看睡眠统计" onPress={() => router.push('/sleep-log/stats' as Href)} style={styles.statsLink}><SymbolView name={{ ios: 'chart.line.uptrend.xyaxis', android: 'show_chart', web: 'show_chart' }} size={14} tintColor={colors.primary} /><Text style={styles.actionText}>统计</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.push('/sleep-log/history' as Href)} style={styles.historyLink}><Text style={styles.actionText}>查看全部</Text><Text style={styles.chevron}>›</Text></Pressable>
        </View>
      </View>
      {hintVisible ? <Text accessibilityLiveRegion="polite" style={[styles.inlineHint, { color: readingTheme.secondary }]}>长按记录可编辑或删除</Text> : null}
      {saveNotice ? <Text accessibilityLiveRegion="polite" style={[styles.inlineHint, { color: colors.primary }]}>{saveNotice}</Text> : null}
      {loading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : records.length ? <View style={[styles.list, { backgroundColor: readingTheme.surface }]}>
        {records.slice(0, 5).map((record, index) => <Pressable key={record.id} accessibilityRole="button" accessibilityLabel={`${nightLabel(record.nightDate)} ${timeLabel(record.occurredAt)}，长按编辑或删除`} onLongPress={() => void manageRecord(record)} delayLongPress={350} style={({ pressed }) => [styles.row, index > 0 && { borderTopColor: readingTheme.border, borderTopWidth: StyleSheet.hairlineWidth }, pressed && styles.pressed]}>
          <View style={[styles.rowIcon, { backgroundColor: readingTheme.background }]}><SymbolView name={{ ios: 'moon.fill', android: 'bedtime', web: 'bedtime' }} size={15} tintColor={colors.primary} /></View>
          <View style={styles.rowText}><Text style={[styles.rowDate, { color: readingTheme.text }]}>{dateLabel(record.nightDate)}</Text></View>
          <Text style={[styles.rowTime, { color: readingTheme.text }]}>{timeLabel(record.occurredAt)}</Text>
        </Pressable>)}
      </View> : <View style={[styles.empty, { backgroundColor: readingTheme.surface }]}><Text style={[styles.emptyTitle, { color: readingTheme.secondary }]}>还没有记录</Text></View>}
    </ScrollView>

    <Modal transparent animationType="slide" visible={Boolean(editing)} onRequestClose={closeEdit}>
      <Pressable style={styles.overlay} onPress={closeEdit}>
        <Pressable style={[styles.editorCard, { backgroundColor: readingTheme.surface }]} onPress={(event) => event.stopPropagation()}>
          <Text style={[styles.editorTitle, { color: readingTheme.text }]}>修改睡眠时间</Text>
          <View style={styles.editActions}>
            <Pressable onPress={() => { setPickerMode('date'); setPickerOpen(true); }} style={[styles.editField, { backgroundColor: readingTheme.background }]}><Text style={[styles.fieldLabel, { color: readingTheme.secondary }]}>日期</Text><Text style={[styles.fieldValue, { color: readingTheme.text }]}>{editValue?.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</Text></Pressable>
            <Pressable onPress={() => { setPickerMode('time'); setPickerOpen(true); }} style={[styles.editField, { backgroundColor: readingTheme.background }]}><Text style={[styles.fieldLabel, { color: readingTheme.secondary }]}>时间</Text><Text style={[styles.fieldValue, { color: readingTheme.text }]}>{editValue?.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</Text></Pressable>
          </View>
          {editValue ? <Text style={[styles.nightPreview, { color: readingTheme.secondary }]}>归入 {fullNightLabel(sleepNightDate(editValue))}</Text> : null}
          {pickerOpen && editValue ? <View style={styles.pickerControl}><DateTimePicker value={editValue} mode={pickerMode} display={Platform.OS === 'ios' ? 'spinner' : 'default'} maximumDate={new Date()} onChange={onPickerChange} /></View> : null}
          <View style={styles.editorButtons}><Pressable onPress={closeEdit} style={styles.cancelAction}><Text style={[styles.cancelText, { color: readingTheme.secondary }]}>取消</Text></Pressable><Pressable disabled={savingEdit} onPress={() => void saveEdit()} style={[styles.saveAction, savingEdit && styles.disabled]}><Text style={styles.saveText}>保存修改</Text></Pressable></View>
        </Pressable>
      </Pressable>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, header: { height: 52, paddingHorizontal: spacing.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth }, back: { color: colors.primary, fontSize: 13 }, headerTitle: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, headerRight: { width: 42 },
  content: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: 28 }, circle: { width: 176, height: 176, marginTop: spacing.md, borderRadius: 88, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', gap: spacing.md }, glassLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 88 }, glassShine: { position: 'absolute', top: 7, left: 18, right: 18, height: 58, borderTopWidth: 2, borderRadius: 88, opacity: 0.7 }, moonMark: { width: 39, height: 39, borderRadius: 20, alignItems: 'center', justifyContent: 'center', opacity: 0.92 }, circlePressed: { transform: [{ scale: 0.98 }], opacity: 0.88 }, pressed: { opacity: 0.82, transform: [{ scale: 0.975 }] }, circleTime: { fontFamily: fonts.serif, fontSize: 22, fontWeight: '600', fontVariant: ['tabular-nums'] },
  undoBar: { width: '100%', minHeight: 40, marginTop: spacing.sm, paddingHorizontal: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, undoText: { fontSize: 11 }, undoButton: { minHeight: 40, paddingHorizontal: spacing.sm, justifyContent: 'center' }, undoButtonText: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  inlineHint: { width: '100%', marginBottom: spacing.xs, fontSize: 11, textAlign: 'center' },
  sectionHeader: { width: '100%', marginTop: spacing.xxl, marginBottom: spacing.sm, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, sectionTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' }, sectionActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, statsLink: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs }, historyLink: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: spacing.sm, paddingLeft: spacing.xs }, actionText: { color: colors.primary, fontSize: 11, fontWeight: '600' }, chevron: { color: colors.primary, fontSize: 17 }, list: { width: '100%', borderRadius: radii.lg, paddingHorizontal: spacing.md }, row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, rowIcon: { width: 32, height: 32, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' }, rowText: { flex: 1 }, rowDate: { fontFamily: fonts.serif, fontSize: 13 }, rowTime: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] }, loader: { marginVertical: spacing.xxl }, empty: { width: '100%', borderRadius: radii.lg, alignItems: 'center', padding: spacing.lg }, emptyTitle: { fontSize: 13 },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl, backgroundColor: colors.overlay }, editorCard: { width: '100%', maxWidth: 430, borderRadius: radii.lg, padding: spacing.lg }, editorTitle: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, editActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }, editField: { flex: 1, minHeight: 64, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radii.md }, fieldLabel: { fontSize: 10 }, fieldValue: { marginTop: 4, fontSize: 13, fontWeight: '600' }, nightPreview: { marginTop: spacing.sm, fontSize: 12 }, pickerControl: { alignItems: 'center', marginTop: spacing.md }, editorButtons: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.md, marginTop: spacing.md }, cancelAction: { minHeight: 42, paddingHorizontal: spacing.md, justifyContent: 'center' }, cancelText: { fontSize: 12 }, saveAction: { minHeight: 42, paddingHorizontal: spacing.lg, borderRadius: radii.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, saveText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' }, disabled: { opacity: 0.35 },
});
