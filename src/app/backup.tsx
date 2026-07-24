import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { createJournalExport, getJournalStats, getLastExportAt, importJournalBackup, saveLastExportAt } from '@/database/journal-repository';
import type { JournalBackup, JournalStats } from '@/domain/journal';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { exportBackupFile } from '@/utils/backup-export';
import { embedBackupImages, materializeBackupImages } from '@/utils/backup-images';
import { parseJournalBackup } from '@/utils/backup-import';
import { formatShortDateTime } from '@/utils/date';
import { deleteJournalImage, getJournalMediaStorageUsage } from '@/utils/image-storage';
import { useAppPreferences } from '@/preferences/app-preferences';

const EMPTY_STATS: JournalStats = { entries: 0, followUps: 0, images: 0, deleted: 0 };
type OperationProgress = { label: string; value: number } | null;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function BackupScreen() {
  const db = useSQLiteContext();
  const { readingTheme } = useAppPreferences();
  const [stats, setStats] = useState(EMPTY_STATS);
  const [lastExportAt, setLastExportAt] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingBackup, setPendingBackup] = useState<JournalBackup | null>(null);
  const [message, setMessage] = useState('');
  const [mediaBytes, setMediaBytes] = useState(0);
  const [operationProgress, setOperationProgress] = useState<OperationProgress>(null);

  const load = useCallback(async () => {
    const [nextStats, exportedAt, storage] = await Promise.all([getJournalStats(db), getLastExportAt(db), getJournalMediaStorageUsage()]);
    setStats(nextStats);
    setLastExportAt(exportedAt);
    setMediaBytes(storage.bytes);
  }, [db]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function exportJson() {
    if (exporting) return;
    setExporting(true);
    setMessage('');
    setOperationProgress({ label: '正在准备记录', value: 0.03 });
    try {
      const source = await createJournalExport(db);
      const backup = await embedBackupImages(source, (completed, total) => {
        setOperationProgress({
          label: total ? `正在读取媒体 ${completed}/${total}` : '正在整理数据',
          value: 0.08 + 0.74 * (total ? completed / total : 1),
        });
      });
      const missingMedia = [...backup.images, ...(backup.followUpImages ?? [])].filter((image) => !image.dataBase64).length;
      const localDate = new Date().toLocaleDateString('sv-SE');
      setOperationProgress({ label: '正在生成备份文件', value: 0.88 });
      const json = JSON.stringify(backup);
      await exportBackupFile(json, `拾时备份-${localDate}.json`);
      const now = new Date().toISOString();
      await saveLastExportAt(db, now);
      setLastExportAt(now);
      setOperationProgress({ label: '备份已完成', value: 1 });
      setMessage(missingMedia ? `备份已生成（约 ${formatBytes(json.length)}），${missingMedia} 个本地媒体文件未找到` : `完整备份已生成（约 ${formatBytes(json.length)}）`);
    } catch {
      setMessage('导出失败，请稍后重试');
    } finally {
      setExporting(false);
      setOperationProgress(null);
    }
  }

  async function chooseBackup() {
    setMessage('');
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/json'], copyToCacheDirectory: true });
      if (picked.canceled) return;
      const contents = await new File(picked.assets[0].uri).text();
      setPendingBackup(parseJournalBackup(contents));
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      setMessage(reason === 'unsupported-backup' ? '暂不支持这个备份版本' : '无法读取这个备份文件');
    }
  }

  async function restoreBackup() {
    if (!pendingBackup || importing) return;
    setImporting(true);
    setOperationProgress({ label: '正在准备恢复', value: 0.03 });
    let createdImageUris: string[] = [];
    try {
      const materialized = await materializeBackupImages(pendingBackup, (completed, total) => {
        setOperationProgress({
          label: total ? `正在恢复媒体 ${completed}/${total}` : '正在恢复数据',
          value: 0.06 + 0.76 * (total ? completed / total : 1),
        });
      });
      createdImageUris = materialized.createdUris;
      setOperationProgress({ label: '正在合并记录', value: 0.88 });
      const result = await importJournalBackup(db, materialized.backup);
      setPendingBackup(null);
      await load();
      const created = result.createdEntries + result.createdFollowUps;
      const updated = result.updatedEntries + result.updatedFollowUps;
      setOperationProgress({ label: '恢复已完成', value: 1 });
      setMessage(`恢复完成：新增 ${created} 条，更新 ${updated} 条`);
    } catch {
      createdImageUris.forEach(deleteJournalImage);
      setPendingBackup(null);
      setMessage('恢复失败，原有记录没有被清空');
    } finally {
      setImporting(false);
      setOperationProgress(null);
    }
  }

  return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}>
      <Pressable hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable>
      <Text style={[styles.title, { color: readingTheme.text }]}>备份与导出</Text><View style={styles.headerSpace} />
    </View>
    <View style={styles.content}>
      <View style={[styles.summary, { backgroundColor: readingTheme.surface }]}>
        <Text style={styles.summaryTitle}>我的日迹</Text>
        <Text style={[styles.summaryCount, { color: readingTheme.text }]}>{stats.entries} 条记录 · {stats.followUps} 条后续 · {stats.images} 个媒体</Text>
        <Text style={[styles.lastExport, { color: readingTheme.secondary }]}>本地媒体占用：{formatBytes(mediaBytes)}</Text>
        {lastExportAt ? <Text style={[styles.lastExport, { color: readingTheme.secondary }]}>上次导出：{formatShortDateTime(lastExportAt)}</Text> : <Text style={[styles.lastExport, { color: readingTheme.secondary }]}>还没有导出过备份</Text>}
      </View>

      <View style={[styles.explanation, { backgroundColor: readingTheme.surface }]}>
        <Text style={[styles.explanationTitle, { color: readingTheme.text }]}>JSON 数据备份</Text>
        <Text style={[styles.explanationText, { color: readingTheme.secondary }]}>包含记录正文、时间、后续、标签、编辑历史、图片、视频和视频封面，可用于换机或重装后恢复。</Text>
        <View style={[styles.notice, { backgroundColor: readingTheme.background }]}><Text style={[styles.noticeText, { color: readingTheme.secondary }]}>媒体文件会写入备份，视频较多时文件会明显变大，导出和恢复也需要更长时间。</Text></View>
      </View>

      <Pressable disabled={exporting} onPress={() => void exportJson()} style={({ pressed }) => [styles.exportButton, (pressed || exporting) && styles.pressed]}>
        {exporting ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.exportText}>导出 JSON 文件</Text>}
      </Pressable>
      <Pressable disabled={importing} onPress={() => void chooseBackup()} style={({ pressed }) => [styles.importButton, pressed && styles.pressed]}><Text style={styles.importText}>从 JSON 恢复</Text></Pressable>
      {operationProgress ? <View style={styles.progressArea}>
        <View style={[styles.progressTrack, { backgroundColor: readingTheme.surface }]}><View style={[styles.progressFill, { width: `${Math.round(operationProgress.value * 100)}%` }]} /></View>
        <Text style={[styles.progressLabel, { color: readingTheme.secondary }]}>{operationProgress.label}</Text>
      </View> : null}
      {message ? <Text style={[styles.message, message.includes('失败') && styles.error]}>{message}</Text> : null}
      <Text style={styles.hint}>手机端会打开系统分享面板，可保存到文件、网盘或发送给自己；Web 端会直接下载。</Text>
    </View>
    <Modal visible={Boolean(pendingBackup)} transparent animationType="fade" onRequestClose={() => setPendingBackup(null)}>
      <Pressable onPress={() => setPendingBackup(null)} style={styles.overlay}>
        <Pressable onPress={(event) => event.stopPropagation()} style={[styles.confirmCard, { backgroundColor: readingTheme.background }]}>
          <Text style={[styles.confirmTitle, { color: readingTheme.text }]}>合并这份备份？</Text>
          {pendingBackup ? <Text style={styles.confirmSummary}>{pendingBackup.entries.length} 条记录 · {pendingBackup.followUps.length} 条后续 · {pendingBackup.tags.length} 个标签</Text> : null}
          <Text style={[styles.confirmHint, { color: readingTheme.secondary }]}>不会清空现有内容；同一记录将保留更新时间较新的版本。</Text>
          <View style={styles.confirmActions}><Pressable onPress={() => setPendingBackup(null)} style={[styles.confirmButton, { backgroundColor: readingTheme.surface }]}><Text style={[styles.cancelText, { color: readingTheme.secondary }]}>取消</Text></Pressable><Pressable disabled={importing} onPress={() => void restoreBackup()} style={[styles.confirmButton, styles.restoreButton]}>{importing ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.restoreText}>开始恢复</Text>}</Pressable></View>
        </Pressable>
      </Pressable>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  back: { color: colors.primary, fontSize: 13 }, title: { color: colors.text, fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, headerSpace: { width: 42 },
  content: { flex: 1, padding: spacing.xl },
  summary: { padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.primarySoft },
  summaryTitle: { color: colors.primary, fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, summaryCount: { marginTop: spacing.sm, color: colors.text, fontSize: 11 }, lastExport: { marginTop: spacing.xs, color: colors.textSecondary, fontSize: 10 },
  explanation: { marginTop: spacing.lg, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surfaceMuted },
  explanationTitle: { color: colors.text, fontSize: 13, fontWeight: '600' }, explanationText: { marginTop: spacing.sm, color: colors.textSecondary, fontSize: 11, lineHeight: 18 },
  notice: { marginTop: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: '#F7EFE2' }, noticeText: { color: '#816E4F', fontSize: 10, lineHeight: 16 },
  exportButton: { height: 46, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xl, borderRadius: radii.pill, backgroundColor: colors.primary }, pressed: { opacity: 0.62 }, exportText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  importButton: { height: 42, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.primarySoft }, importText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  message: { marginTop: spacing.md, color: colors.primary, fontSize: 11, textAlign: 'center' }, error: { color: colors.danger },
  progressArea: { marginTop: spacing.md }, progressTrack: { height: 5, overflow: 'hidden', borderRadius: radii.pill, backgroundColor: colors.surfaceMuted }, progressFill: { height: '100%', borderRadius: radii.pill, backgroundColor: colors.primary }, progressLabel: { marginTop: spacing.xs, color: colors.textSecondary, fontSize: 9, textAlign: 'center' },
  hint: { marginTop: spacing.lg, paddingHorizontal: spacing.md, color: colors.textFaint, fontSize: 10, lineHeight: 17, textAlign: 'center' },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.overlay }, confirmCard: { width: '100%', maxWidth: 320, padding: spacing.xl, borderRadius: radii.lg, backgroundColor: colors.background },
  confirmTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 18, fontWeight: '600', textAlign: 'center' }, confirmSummary: { marginTop: spacing.md, color: colors.primary, fontSize: 11, fontWeight: '600', textAlign: 'center' }, confirmHint: { marginTop: spacing.sm, color: colors.textFaint, fontSize: 10, lineHeight: 16, textAlign: 'center' },
  confirmActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl }, confirmButton: { flex: 1, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.surfaceMuted }, restoreButton: { backgroundColor: colors.primary }, cancelText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' }, restoreText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});
