import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { createJournalExport, getJournalStats, getLastExportAt, importJournalBackup, saveLastExportAt } from '@/database/journal-repository';
import type { JournalBackup, JournalStats } from '@/domain/journal';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { exportBackupBytes } from '@/utils/backup-export';
import { materializeBackupImages } from '@/utils/backup-images';
import { parseJournalBackup } from '@/utils/backup-import';
import { createZipBackup, inspectZipBackup, materializeZipBackup } from '@/utils/backup-zip';
import { formatShortDateTime } from '@/utils/date';
import { deleteJournalImage, getJournalMediaStorageUsage } from '@/utils/image-storage';
import { useAppPreferences } from '@/preferences/app-preferences';
import { setBackupReminder } from '@/utils/backup-reminder';
import { chooseBackupDirectory, saveBackupToDirectory } from '@/utils/backup-directory';

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
  const { preferences, readingTheme, updatePreferences } = useAppPreferences();
  const [stats, setStats] = useState(EMPTY_STATS);
  const [lastExportAt, setLastExportAt] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingBackup, setPendingBackup] = useState<JournalBackup | null>(null);
  const [pendingZipUri, setPendingZipUri] = useState<string | null>(null);
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

  async function createVerifiedArchive() {
    const source = await createJournalExport(db);
    const archive = await createZipBackup(source, (completed, total) => {
      setOperationProgress({
        label: total ? `正在读取媒体 ${completed}/${total}` : '正在整理数据',
        value: 0.08 + 0.74 * (total ? completed / total : 1),
      });
    });
    const inspected = inspectZipBackup(archive.bytes);
    if (inspected.entries.length !== source.entries.length || inspected.followUps.length !== source.followUps.length) {
      throw new Error('backup-verification-failed');
    }
    return archive;
  }

  async function finishSuccessfulBackup(missingMedia: number) {
    const now = new Date().toISOString();
    await saveLastExportAt(db, now);
    setLastExportAt(now);
    const health = missingMedia ? 'warning' : 'healthy';
    await updatePreferences({ lastBackupCheckAt: now, lastBackupHealth: health });
    if (!missingMedia && preferences.backupReminderDays) {
      await setBackupReminder(preferences.backupReminderDays, now);
    }
  }

  async function exportZip() {
    if (exporting) return;
    setExporting(true);
    setMessage('');
    setOperationProgress({ label: '正在准备记录', value: 0.03 });
    try {
      const archive = await createVerifiedArchive();
      const localDate = new Date().toLocaleDateString('sv-SE');
      setOperationProgress({ label: '正在生成 ZIP 文件', value: 0.88 });
      await exportBackupBytes(archive.bytes, `拾时备份-${localDate}.zip`);
      await finishSuccessfulBackup(archive.missingMedia);
      setOperationProgress({ label: '备份已完成', value: 1 });
      setMessage(archive.missingMedia ? `ZIP 备份已生成（${formatBytes(archive.bytes.length)}），${archive.missingMedia} 个本地媒体文件未找到` : `完整 ZIP 备份已生成（${formatBytes(archive.bytes.length)}）`);
    } catch {
      const now = new Date().toISOString();
      await updatePreferences({ lastBackupCheckAt: now, lastBackupHealth: 'failed' }).catch(() => undefined);
      setMessage('导出失败，请稍后重试');
    } finally {
      setExporting(false);
      setOperationProgress(null);
    }
  }

  async function selectBackupDirectory() {
    setMessage('');
    try {
      const result = await chooseBackupDirectory(preferences.backupDirectoryUri);
      if (!result.granted || !result.directoryUri) return;
      await updatePreferences({
        backupDirectoryUri: result.directoryUri,
        backupDirectoryLabel: '系统或网盘目录',
      });
      setMessage('备份目录已设置。拾时只会在此目录中管理自己生成的备份文件。');
    } catch {
      setMessage('无法授权这个目录，请换一个目录再试');
    }
  }

  async function saveToSelectedDirectory() {
    if (!preferences.backupDirectoryUri || exporting) {
      if (!preferences.backupDirectoryUri) await selectBackupDirectory();
      return;
    }
    setExporting(true);
    setMessage('');
    setOperationProgress({ label: '正在准备记录', value: 0.03 });
    try {
      const archive = await createVerifiedArchive();
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      setOperationProgress({ label: '正在写入备份目录', value: 0.88 });
      const saved = await saveBackupToDirectory(
        preferences.backupDirectoryUri,
        archive.bytes,
        `拾时备份-${stamp}`,
        5,
      );
      await finishSuccessfulBackup(archive.missingMedia);
      setOperationProgress({ label: '目录备份已完成', value: 1 });
      setMessage(archive.missingMedia
        ? `已写入目录（${formatBytes(saved.size)}），但有 ${archive.missingMedia} 个本地媒体缺失`
        : `已写入并校验（${formatBytes(saved.size)}），目录中保留最近 ${saved.retained} 份`);
    } catch {
      const now = new Date().toISOString();
      await updatePreferences({ lastBackupCheckAt: now, lastBackupHealth: 'failed' }).catch(() => undefined);
      setMessage('目录备份失败。请重新选择目录，或检查网盘是否仍可用。');
    } finally {
      setExporting(false);
      setOperationProgress(null);
    }
  }

  async function checkBackupHealth() {
    setMessage('');
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/zip', 'application/x-zip-compressed'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;
      const backup = inspectZipBackup(await new File(picked.assets[0].uri).bytes());
      const now = new Date().toISOString();
      await updatePreferences({ lastBackupCheckAt: now, lastBackupHealth: 'healthy' });
      setMessage(`备份健康：可恢复 ${backup.entries.length} 条记录、${backup.followUps.length} 条后续`);
    } catch {
      const now = new Date().toISOString();
      await updatePreferences({ lastBackupCheckAt: now, lastBackupHealth: 'failed' });
      setMessage('备份检查失败：ZIP 已损坏、缺少数据或媒体文件');
    }
  }

  async function chooseBackup() {
    setMessage('');
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ['application/zip', 'application/x-zip-compressed', 'application/json', 'text/json'], copyToCacheDirectory: true });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      const file = new File(asset.uri);
      const isZip = asset.name.toLowerCase().endsWith('.zip') || asset.mimeType?.includes('zip');
      if (isZip) {
        setPendingBackup(inspectZipBackup(await file.bytes()));
        setPendingZipUri(asset.uri);
      } else {
        setPendingBackup(parseJournalBackup(await file.text()));
        setPendingZipUri(null);
      }
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
    let imported = false;
    try {
      const reportProgress = (completed: number, total: number) => {
        setOperationProgress({
          label: total ? `正在恢复媒体 ${completed}/${total}` : '正在恢复数据',
          value: 0.06 + 0.76 * (total ? completed / total : 1),
        });
      };
      const materialized = pendingZipUri
        ? await materializeZipBackup(await new File(pendingZipUri).bytes(), reportProgress)
        : await materializeBackupImages(pendingBackup, reportProgress);
      createdImageUris = materialized.createdUris;
      setOperationProgress({ label: '正在合并记录', value: 0.88 });
      const result = await importJournalBackup(db, materialized.backup);
      imported = true;
      setPendingBackup(null);
      setPendingZipUri(null);
      await load();
      const created = result.createdEntries + result.createdFollowUps;
      const updated = result.updatedEntries + result.updatedFollowUps;
      setOperationProgress({ label: '恢复已完成', value: 1 });
      setMessage(`恢复完成：新增 ${created} 条，更新 ${updated} 条`);
    } catch (error) {
      if (!imported) createdImageUris.forEach(deleteJournalImage);
      setPendingBackup(null);
      setPendingZipUri(null);
      const reason = error instanceof Error ? error.message : '';
      setMessage(reason === 'missing-backup-media' ? '备份文件不完整，未恢复任何数据' : '恢复失败，原有记录没有被清空');
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
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={[styles.summary, { backgroundColor: readingTheme.surface }]}>
        <Text style={styles.summaryTitle}>我的日迹</Text>
        <Text style={[styles.summaryCount, { color: readingTheme.text }]}>{stats.entries} 条记录 · {stats.followUps} 条后续 · {stats.images} 个媒体</Text>
        <Text style={[styles.lastExport, { color: readingTheme.secondary }]}>本地媒体占用：{formatBytes(mediaBytes)}</Text>
        {lastExportAt ? <Text style={[styles.lastExport, { color: readingTheme.secondary }]}>上次导出：{formatShortDateTime(lastExportAt)}</Text> : <Text style={[styles.lastExport, { color: readingTheme.secondary }]}>还没有导出过备份</Text>}
        <View style={styles.healthRow}>
          <View style={[styles.healthDot, preferences.lastBackupHealth === 'healthy' ? styles.healthGood : preferences.lastBackupHealth === 'warning' ? styles.healthWarning : preferences.lastBackupHealth === 'failed' ? styles.healthBad : styles.healthUnknown]} />
          <Text style={[styles.lastExport, styles.healthText, { color: readingTheme.secondary }]}>
            {preferences.lastBackupHealth === 'healthy'
              ? '最近检查：备份完整可恢复'
              : preferences.lastBackupHealth === 'warning'
                ? '最近检查：备份可打开，但有本地媒体缺失'
                : preferences.lastBackupHealth === 'failed'
                  ? '最近检查：备份不可恢复'
                  : '尚未进行备份健康检查'}
            {preferences.lastBackupCheckAt ? ` · ${formatShortDateTime(preferences.lastBackupCheckAt)}` : ''}
          </Text>
        </View>
      </View>

      <View style={[styles.explanation, { backgroundColor: readingTheme.surface }]}>
        <Text style={[styles.explanationTitle, { color: readingTheme.text }]}>ZIP 完整备份</Text>
        <Text style={[styles.explanationText, { color: readingTheme.secondary }]}>记录数据保存为独立 JSON，图片、视频和封面按文件存放，避免 Base64 额外增加约三分之一体积。</Text>
        <View style={[styles.notice, { backgroundColor: readingTheme.background }]}><Text style={[styles.noticeText, { color: readingTheme.secondary }]}>仍兼容以前导出的 JSON 备份；视频较多时导出和恢复需要更长时间。</Text></View>
      </View>

      <View style={[styles.directoryCard, { borderColor: readingTheme.border }]}>
        <View style={styles.directoryCopy}>
          <Text style={[styles.explanationTitle, { color: readingTheme.text }]}>固定备份目录</Text>
          <Text style={[styles.explanationText, { color: readingTheme.secondary }]}>
            {preferences.backupDirectoryUri ? `已连接：${preferences.backupDirectoryLabel ?? '系统目录'} · 自动保留最近 5 份` : '选择手机文件夹或系统文件管理器中的网盘目录'}
          </Text>
        </View>
        <Pressable onPress={() => void selectBackupDirectory()} style={({ pressed }) => [styles.directorySelect, { backgroundColor: readingTheme.surface }, pressed && styles.pressed]}>
          <Text style={styles.directorySelectText}>{preferences.backupDirectoryUri ? '更换' : '选择'}</Text>
        </Pressable>
      </View>
      <Pressable disabled={exporting} onPress={() => void saveToSelectedDirectory()} style={({ pressed }) => [styles.exportButton, (pressed || exporting) && styles.pressed]}>
        {exporting ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.exportText}>{preferences.backupDirectoryUri ? '备份到固定目录' : '选择目录并备份'}</Text>}
      </Pressable>
      <Pressable disabled={exporting} onPress={() => void exportZip()} style={({ pressed }) => [styles.exportButton, (pressed || exporting) && styles.pressed]}>
        <Text style={styles.exportText}>通过其他应用导出 ZIP</Text>
      </Pressable>
      <Pressable disabled={importing} onPress={() => void chooseBackup()} style={({ pressed }) => [styles.importButton, pressed && styles.pressed]}><Text style={styles.importText}>从 ZIP 或 JSON 恢复</Text></Pressable>
      <Pressable disabled={exporting || importing} onPress={() => void checkBackupHealth()} style={({ pressed }) => [styles.checkButton, { borderColor: readingTheme.border }, pressed && styles.pressed]}><Text style={[styles.checkText, { color: readingTheme.secondary }]}>检查一个 ZIP 备份</Text></Pressable>
      {operationProgress ? <View style={styles.progressArea}>
        <View style={[styles.progressTrack, { backgroundColor: readingTheme.surface }]}><View style={[styles.progressFill, { width: `${Math.round(operationProgress.value * 100)}%` }]} /></View>
        <Text style={[styles.progressLabel, { color: readingTheme.secondary }]}>{operationProgress.label}</Text>
      </View> : null}
      {message ? <Text style={[styles.message, message.includes('失败') && styles.error]}>{message}</Text> : null}
      <Text style={styles.hint}>固定目录备份仅在 Android 可用；如果网盘未出现在系统目录选择器中，请使用“通过其他应用导出 ZIP”。</Text>
    </ScrollView>
    <Modal visible={Boolean(pendingBackup)} transparent animationType="fade" onRequestClose={() => { setPendingBackup(null); setPendingZipUri(null); }}>
      <Pressable onPress={() => { setPendingBackup(null); setPendingZipUri(null); }} style={styles.overlay}>
        <Pressable onPress={(event) => event.stopPropagation()} style={[styles.confirmCard, { backgroundColor: readingTheme.background }]}>
          <Text style={[styles.confirmTitle, { color: readingTheme.text }]}>合并这份备份？</Text>
          {pendingBackup ? <Text style={styles.confirmSummary}>{pendingBackup.entries.length} 条记录 · {pendingBackup.followUps.length} 条后续 · {pendingBackup.tags.length} 个标签</Text> : null}
          <Text style={[styles.confirmHint, { color: readingTheme.secondary }]}>不会清空现有内容；同一记录将保留更新时间较新的版本。</Text>
          <View style={styles.confirmActions}><Pressable onPress={() => { setPendingBackup(null); setPendingZipUri(null); }} style={[styles.confirmButton, { backgroundColor: readingTheme.surface }]}><Text style={[styles.cancelText, { color: readingTheme.secondary }]}>取消</Text></Pressable><Pressable disabled={importing} onPress={() => void restoreBackup()} style={[styles.confirmButton, styles.restoreButton]}>{importing ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.restoreText}>开始恢复</Text>}</Pressable></View>
        </Pressable>
      </Pressable>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  back: { color: colors.primary, fontSize: 13 }, title: { color: colors.text, fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, headerSpace: { width: 42 },
  content: { padding: spacing.xl, paddingBottom: spacing.xxxl },
  summary: { padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.primarySoft },
  summaryTitle: { color: colors.primary, fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, summaryCount: { marginTop: spacing.sm, color: colors.text, fontSize: 11 }, lastExport: { marginTop: spacing.xs, color: colors.textSecondary, fontSize: 10 },
  healthRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  healthDot: { width: 7, height: 7, marginRight: 6, borderRadius: 4 },
  healthGood: { backgroundColor: colors.primary },
  healthWarning: { backgroundColor: '#C99742' },
  healthBad: { backgroundColor: colors.danger },
  healthUnknown: { backgroundColor: colors.textFaint },
  healthText: { flex: 1, marginTop: 0 },
  explanation: { marginTop: spacing.lg, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surfaceMuted },
  explanationTitle: { color: colors.text, fontSize: 13, fontWeight: '600' }, explanationText: { marginTop: spacing.sm, color: colors.textSecondary, fontSize: 11, lineHeight: 18 },
  notice: { marginTop: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: '#F7EFE2' }, noticeText: { color: '#816E4F', fontSize: 10, lineHeight: 16 },
  directoryCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg },
  directoryCopy: { flex: 1 },
  directorySelect: { minWidth: 58, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill },
  directorySelectText: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  exportButton: { height: 46, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xl, borderRadius: radii.pill, backgroundColor: colors.primary }, pressed: { opacity: 0.62 }, exportText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  importButton: { height: 42, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.primarySoft }, importText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  checkButton: { height: 38, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.pill },
  checkText: { fontSize: 11, fontWeight: '600' },
  message: { marginTop: spacing.md, color: colors.primary, fontSize: 11, textAlign: 'center' }, error: { color: colors.danger },
  progressArea: { marginTop: spacing.md }, progressTrack: { height: 5, overflow: 'hidden', borderRadius: radii.pill, backgroundColor: colors.surfaceMuted }, progressFill: { height: '100%', borderRadius: radii.pill, backgroundColor: colors.primary }, progressLabel: { marginTop: spacing.xs, color: colors.textSecondary, fontSize: 9, textAlign: 'center' },
  hint: { marginTop: spacing.lg, paddingHorizontal: spacing.md, color: colors.textFaint, fontSize: 10, lineHeight: 17, textAlign: 'center' },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.overlay }, confirmCard: { width: '100%', maxWidth: 320, padding: spacing.xl, borderRadius: radii.lg, backgroundColor: colors.background },
  confirmTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 18, fontWeight: '600', textAlign: 'center' }, confirmSummary: { marginTop: spacing.md, color: colors.primary, fontSize: 11, fontWeight: '600', textAlign: 'center' }, confirmHint: { marginTop: spacing.sm, color: colors.textFaint, fontSize: 10, lineHeight: 16, textAlign: 'center' },
  confirmActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl }, confirmButton: { flex: 1, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.surfaceMuted }, restoreButton: { backgroundColor: colors.primary }, cancelText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' }, restoreText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});
