import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, type Href } from 'expo-router';
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
import { AUTOMATIC_BACKUP_RETENTION } from '@/utils/automatic-backup';
import { recordAppError } from '@/utils/app-error-log';

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
  const [advancedVisible, setAdvancedVisible] = useState(false);

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
    } catch (error) {
      void recordAppError('backup.export-zip', error);
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
    } catch (error) {
      void recordAppError('backup.select-directory', error);
      setMessage('无法授权这个目录，请换一个目录再试');
    }
  }

  async function toggleAutomaticBackup() {
    if (preferences.automaticBackupEnabled) {
      await updatePreferences({ automaticBackupEnabled: false });
      setMessage('自动备份已关闭，已有备份文件不会删除。');
      return;
    }
    if (preferences.backupDirectoryUri) {
      await updatePreferences({ automaticBackupEnabled: true });
      setMessage('自动备份已开启，将在应用回到前台时每天检查一次。');
      return;
    }
    try {
      const result = await chooseBackupDirectory();
      if (!result.granted || !result.directoryUri) return;
      await updatePreferences({
        backupDirectoryUri: result.directoryUri,
        backupDirectoryLabel: '系统或网盘目录',
        automaticBackupEnabled: true,
      });
      setMessage('目录已设置，自动备份已开启。');
    } catch (error) {
      void recordAppError('backup.enable-automatic', error);
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
        AUTOMATIC_BACKUP_RETENTION,
      );
      await finishSuccessfulBackup(archive.missingMedia);
      setOperationProgress({ label: '目录备份已完成', value: 1 });
      setMessage(archive.missingMedia
        ? `已写入目录（${formatBytes(saved.size)}），但有 ${archive.missingMedia} 个本地媒体缺失`
        : `已写入并校验（${formatBytes(saved.size)}），目录中保留最近 ${saved.retained} 份`);
    } catch (error) {
      void recordAppError('backup.save-directory', error);
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
    } catch (error) {
      void recordAppError('backup.health-check', error);
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
      void recordAppError('backup.read-restore-file', error);
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
      const restoredPreferences = materialized.backup.appPreferences;
      if (restoredPreferences) {
        await updatePreferences({
          nickname: restoredPreferences.nickname,
          signature: restoredPreferences.signature,
          avatarUri: restoredPreferences.avatarLocalUri,
          themeMode: restoredPreferences.themeMode,
          fontSize: restoredPreferences.fontSize,
          readingTheme: restoredPreferences.readingTheme,
          readingFont: restoredPreferences.readingFont,
          appLockEnabled: restoredPreferences.appLockEnabled,
          appLockDelaySeconds: restoredPreferences.appLockDelaySeconds,
          backupReminderDays: restoredPreferences.backupReminderDays,
          locationPrivacyMode: restoredPreferences.locationPrivacyMode ?? 'precise',
          exportLocationMode: restoredPreferences.exportLocationMode ?? 'include',
        });
        await setBackupReminder(restoredPreferences.backupReminderDays).catch(() => undefined);
      }
      setPendingBackup(null);
      setPendingZipUri(null);
      await load();
      const created = result.createdEntries + result.createdFollowUps;
      const updated = result.updatedEntries + result.updatedFollowUps;
      setOperationProgress({ label: '恢复已完成', value: 1 });
      setMessage(`恢复完成：新增 ${created} 条，更新 ${updated} 条${restoredPreferences ? '，个人资料和设置已恢复' : ''}`);
    } catch (error) {
      void recordAppError('backup.restore', error);
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

      <Pressable disabled={exporting} onPress={() => void exportZip()} style={({ pressed }) => [styles.exportButton, (pressed || exporting) && styles.pressed]}>
        {exporting ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.exportText}>立即备份 ZIP</Text>}
      </Pressable>
      <Pressable disabled={importing} onPress={() => void chooseBackup()} style={({ pressed }) => [styles.importButton, pressed && styles.pressed]}><Text style={styles.importText}>从 ZIP 或 JSON 恢复</Text></Pressable>
      <Pressable accessibilityState={{ expanded: advancedVisible }} onPress={() => setAdvancedVisible((value) => !value)} style={[styles.advancedToggle, { borderColor: readingTheme.border }]}>
        <Text style={[styles.advancedToggleText, { color: readingTheme.secondary }]}>更多备份选项</Text>
        <View style={[styles.advancedChevron, advancedVisible && styles.advancedChevronOpen]} />
      </Pressable>
      {advancedVisible ? <View style={styles.advancedArea}>
        <View style={[styles.explanation, { backgroundColor: readingTheme.surface }]}>
          <Text style={[styles.explanationTitle, { color: readingTheme.text }]}>完整备份说明</Text>
          <Text style={[styles.explanationText, { color: readingTheme.secondary }]}>ZIP 会保存记录、个人资料、设置和本地媒体；仍兼容以前导出的 JSON 备份。</Text>
        </View>
        <Pressable onPress={() => router.push('/readable-export' as Href)} style={({ pressed }) => [styles.readableCard, { backgroundColor: readingTheme.surface }, pressed && styles.pressed]}>
          <View style={styles.directoryCopy}><Text style={[styles.explanationTitle, { color: readingTheme.text }]}>可阅读导出</Text><Text style={[styles.explanationText, { color: readingTheme.secondary }]}>生成 Markdown / HTML，用于阅读或打印</Text></View><Text style={styles.readableArrow}>›</Text>
        </Pressable>
        <View style={[styles.directoryCard, { borderColor: readingTheme.border }]}>
          <View style={styles.directoryCopy}>
            <Text style={[styles.explanationTitle, { color: readingTheme.text }]}>固定备份目录</Text>
            <Text style={[styles.explanationText, { color: readingTheme.secondary }]}>
              {preferences.backupDirectoryUri ? `已连接：${preferences.backupDirectoryLabel ?? '系统目录'} · 保留最近 5 份` : '选择手机文件夹或系统文件管理器中的网盘目录'}
            </Text>
          </View>
          <Pressable onPress={() => void selectBackupDirectory()} style={({ pressed }) => [styles.directorySelect, { backgroundColor: readingTheme.surface }, pressed && styles.pressed]}>
            <Text style={styles.directorySelectText}>{preferences.backupDirectoryUri ? '更换' : '选择'}</Text>
          </Pressable>
        </View>
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: preferences.automaticBackupEnabled }} onPress={() => void toggleAutomaticBackup()} style={[styles.autoBackupRow, { backgroundColor: readingTheme.surface }]}>
          <View style={styles.directoryCopy}>
            <Text style={[styles.explanationTitle, { color: readingTheme.text }]}>每日自动备份</Text>
            <Text style={[styles.explanationText, { color: readingTheme.secondary }]}>
              {preferences.lastAutomaticBackupAt ? `最近自动备份：${formatShortDateTime(preferences.lastAutomaticBackupAt)}` : '打开应用时检查，并自动保留最近 5 份'}
            </Text>
          </View>
          <View style={[styles.switchTrack, preferences.automaticBackupEnabled && styles.switchTrackActive]}><View style={[styles.switchThumb, preferences.automaticBackupEnabled && styles.switchThumbActive]} /></View>
        </Pressable>
        <Pressable disabled={exporting} onPress={() => void saveToSelectedDirectory()} style={({ pressed }) => [styles.directoryBackupButton, (pressed || exporting) && styles.pressed]}>
          <Text style={styles.directoryBackupText}>{preferences.backupDirectoryUri ? '备份到固定目录' : '选择目录并备份'}</Text>
        </Pressable>
        <Pressable disabled={exporting || importing} onPress={() => void checkBackupHealth()} style={({ pressed }) => [styles.checkButton, { borderColor: readingTheme.border }, pressed && styles.pressed]}><Text style={[styles.checkText, { color: readingTheme.secondary }]}>检查一个 ZIP 备份</Text></Pressable>
        <Text style={styles.hint}>固定目录备份仅在 Android 可用；网盘未出现在目录选择器中时，请使用上方“立即备份 ZIP”。</Text>
      </View> : null}
      {operationProgress ? <View style={styles.progressArea}>
        <View style={[styles.progressTrack, { backgroundColor: readingTheme.surface }]}><View style={[styles.progressFill, { width: `${Math.round(operationProgress.value * 100)}%` }]} /></View>
        <Text style={[styles.progressLabel, { color: readingTheme.secondary }]}>{operationProgress.label}</Text>
      </View> : null}
      {message ? <Text style={[styles.message, message.includes('失败') && styles.error]}>{message}</Text> : null}
    </ScrollView>
    <Modal visible={Boolean(pendingBackup)} transparent animationType="fade" onRequestClose={() => { setPendingBackup(null); setPendingZipUri(null); }}>
      <Pressable onPress={() => { setPendingBackup(null); setPendingZipUri(null); }} style={styles.overlay}>
        <Pressable onPress={(event) => event.stopPropagation()} style={[styles.confirmCard, { backgroundColor: readingTheme.background }]}>
          <Text style={[styles.confirmTitle, { color: readingTheme.text }]}>合并这份备份？</Text>
          {pendingBackup ? <>
            <Text style={styles.confirmSummary}>{pendingBackup.entries.length} 条记录 · {pendingBackup.followUps.length} 条后续 · {pendingBackup.images.length + (pendingBackup.followUpImages?.length ?? 0)} 个媒体</Text>
            <View style={[styles.preview, { backgroundColor: readingTheme.surface }]}>
              <View style={styles.previewRow}><Text style={[styles.previewLabel, { color: readingTheme.secondary }]}>备份时间</Text><Text style={[styles.previewValue, { color: readingTheme.text }]}>{formatShortDateTime(pendingBackup.exportedAt)}</Text></View>
              <View style={styles.previewRow}><Text style={[styles.previewLabel, { color: readingTheme.secondary }]}>备份版本</Text><Text style={[styles.previewValue, { color: readingTheme.text }]}>v{pendingBackup.version}</Text></View>
              <View style={styles.previewRow}><Text style={[styles.previewLabel, { color: readingTheme.secondary }]}>地点目录</Text><Text style={[styles.previewValue, { color: readingTheme.text }]}>{pendingBackup.metadataCatalog?.locations.length ?? 0} 个地点</Text></View>
              <View style={styles.previewRow}><Text style={[styles.previewLabel, { color: readingTheme.secondary }]}>个人资料</Text><Text style={[styles.previewValue, { color: readingTheme.text }]}>{pendingBackup.appPreferences ? `${pendingBackup.appPreferences.nickname}${pendingBackup.appPreferences.avatarLocalUri ? ' · 含头像' : ''}` : '旧版备份未包含'}</Text></View>
              <View style={styles.previewRow}><Text style={[styles.previewLabel, { color: readingTheme.secondary }]}>显示与安全设置</Text><Text style={[styles.previewValue, { color: readingTheme.text }]}>{pendingBackup.appPreferences ? '将一并恢复' : '保留本机设置'}</Text></View>
            </View>
          </> : null}
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
  summaryTitle: { color: colors.primary, fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, summaryCount: { marginTop: spacing.sm, color: colors.text, fontSize: 12 }, lastExport: { marginTop: spacing.xs, color: colors.textSecondary, fontSize: 11 },
  healthRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  healthDot: { width: 7, height: 7, marginRight: 6, borderRadius: 4 },
  healthGood: { backgroundColor: colors.primary },
  healthWarning: { backgroundColor: '#C99742' },
  healthBad: { backgroundColor: colors.danger },
  healthUnknown: { backgroundColor: colors.textFaint },
  healthText: { flex: 1, marginTop: 0 },
  explanation: { marginTop: spacing.lg, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surfaceMuted },
  advancedToggle: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  advancedToggleText: { fontSize: 11, fontWeight: '600' },
  advancedChevron: { width: 7, height: 7, marginTop: -3, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: colors.primary, transform: [{ rotate: '45deg' }] },
  advancedChevronOpen: { marginTop: 4, transform: [{ rotate: '-135deg' }] },
  advancedArea: { paddingBottom: spacing.sm },
  readableCard: { minHeight: 60, flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, padding: spacing.md, borderRadius: radii.md }, readableArrow: { marginLeft: spacing.md, color: colors.primary, fontSize: 20 },
  explanationTitle: { color: colors.text, fontSize: 13, fontWeight: '600' }, explanationText: { marginTop: spacing.sm, color: colors.textSecondary, fontSize: 11, lineHeight: 18 },
  notice: { marginTop: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: '#F7EFE2' }, noticeText: { color: '#816E4F', fontSize: 11, lineHeight: 17 },
  directoryCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg },
  directoryCopy: { flex: 1 },
  directorySelect: { minWidth: 58, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill },
  directorySelectText: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  autoBackupRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm, padding: spacing.md, borderRadius: radii.lg },
  switchTrack: { width: 44, height: 26, justifyContent: 'center', paddingHorizontal: 3, borderRadius: 13, backgroundColor: colors.border },
  switchTrackActive: { backgroundColor: colors.primary },
  switchThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF' },
  switchThumbActive: { alignSelf: 'flex-end' },
  exportButton: { height: 46, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xl, borderRadius: radii.pill, backgroundColor: colors.primary }, pressed: { opacity: 0.62 }, exportText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  importButton: { height: 42, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.primarySoft }, importText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  directoryBackupButton: { height: 40, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.primarySoft }, directoryBackupText: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  checkButton: { height: 38, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.pill },
  checkText: { fontSize: 11, fontWeight: '600' },
  message: { marginTop: spacing.md, color: colors.primary, fontSize: 11, textAlign: 'center' }, error: { color: colors.danger },
  progressArea: { marginTop: spacing.md }, progressTrack: { height: 5, overflow: 'hidden', borderRadius: radii.pill, backgroundColor: colors.surfaceMuted }, progressFill: { height: '100%', borderRadius: radii.pill, backgroundColor: colors.primary }, progressLabel: { marginTop: spacing.xs, color: colors.textSecondary, fontSize: 11, textAlign: 'center' },
  hint: { marginTop: spacing.lg, paddingHorizontal: spacing.md, color: colors.textFaint, fontSize: 11, lineHeight: 18, textAlign: 'center' },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.overlay }, confirmCard: { width: '100%', maxWidth: 320, padding: spacing.xl, borderRadius: radii.lg, backgroundColor: colors.background },
  confirmTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 18, fontWeight: '600', textAlign: 'center' }, confirmSummary: { marginTop: spacing.md, color: colors.primary, fontSize: 12, fontWeight: '600', textAlign: 'center' }, confirmHint: { marginTop: spacing.sm, color: colors.textFaint, fontSize: 11, lineHeight: 17, textAlign: 'center' },
  preview: { gap: spacing.sm, marginTop: spacing.lg, padding: spacing.md, borderRadius: radii.md },
  previewRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  previewLabel: { flexShrink: 0, fontSize: 11, lineHeight: 18 },
  previewValue: { flex: 1, fontSize: 11, fontWeight: '600', lineHeight: 18, textAlign: 'right' },
  confirmActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl }, confirmButton: { flex: 1, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.surfaceMuted }, restoreButton: { backgroundColor: colors.primary }, cancelText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' }, restoreText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});
