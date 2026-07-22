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
import { deleteJournalImage } from '@/utils/image-storage';
import { useAppPreferences } from '@/preferences/app-preferences';

const EMPTY_STATS: JournalStats = { entries: 0, followUps: 0, images: 0, deleted: 0 };

export default function BackupScreen() {
  const db = useSQLiteContext();
  const { readingTheme } = useAppPreferences();
  const [stats, setStats] = useState(EMPTY_STATS);
  const [lastExportAt, setLastExportAt] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingBackup, setPendingBackup] = useState<JournalBackup | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const [nextStats, exportedAt] = await Promise.all([getJournalStats(db), getLastExportAt(db)]);
    setStats(nextStats);
    setLastExportAt(exportedAt);
  }, [db]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function exportJson() {
    if (exporting) return;
    setExporting(true);
    setMessage('');
    try {
      const backup = await embedBackupImages(await createJournalExport(db));
      const missingImages = backup.images.filter((image) => !image.dataBase64).length;
      const localDate = new Date().toLocaleDateString('sv-SE');
      await exportBackupFile(JSON.stringify(backup, null, 2), `拾时备份-${localDate}.json`);
      const now = new Date().toISOString();
      await saveLastExportAt(db, now);
      setLastExportAt(now);
      setMessage(missingImages ? `备份已生成，${missingImages} 张本地图片未找到` : '完整备份文件已生成');
    } catch {
      setMessage('导出失败，请稍后重试');
    } finally {
      setExporting(false);
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
    let createdImageUris: string[] = [];
    try {
      const materialized = await materializeBackupImages(pendingBackup);
      createdImageUris = materialized.createdUris;
      const result = await importJournalBackup(db, materialized.backup);
      setPendingBackup(null);
      await load();
      const created = result.createdEntries + result.createdFollowUps;
      const updated = result.updatedEntries + result.updatedFollowUps;
      setMessage(`恢复完成：新增 ${created} 条，更新 ${updated} 条`);
    } catch {
      createdImageUris.forEach(deleteJournalImage);
      setPendingBackup(null);
      setMessage('恢复失败，原有记录没有被清空');
    } finally {
      setImporting(false);
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
        <Text style={[styles.summaryCount, { color: readingTheme.text }]}>{stats.entries} 条记录 · {stats.followUps} 条后续 · {stats.images} 张图片</Text>
        {lastExportAt ? <Text style={[styles.lastExport, { color: readingTheme.secondary }]}>上次导出：{formatShortDateTime(lastExportAt)}</Text> : <Text style={[styles.lastExport, { color: readingTheme.secondary }]}>还没有导出过备份</Text>}
      </View>

      <View style={[styles.explanation, { backgroundColor: readingTheme.surface }]}>
        <Text style={[styles.explanationTitle, { color: readingTheme.text }]}>JSON 数据备份</Text>
        <Text style={[styles.explanationText, { color: readingTheme.secondary }]}>包含记录正文、时间、后续、标签、编辑历史和图片内容，可用于换机或重装后恢复。</Text>
        <View style={[styles.notice, { backgroundColor: readingTheme.background }]}><Text style={[styles.noticeText, { color: readingTheme.secondary }]}>图片会写入备份文件，照片较多时导出和恢复可能需要一些时间。</Text></View>
      </View>

      <Pressable disabled={exporting} onPress={() => void exportJson()} style={({ pressed }) => [styles.exportButton, (pressed || exporting) && styles.pressed]}>
        {exporting ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.exportText}>导出 JSON 文件</Text>}
      </Pressable>
      <Pressable disabled={importing} onPress={() => void chooseBackup()} style={({ pressed }) => [styles.importButton, pressed && styles.pressed]}><Text style={styles.importText}>从 JSON 恢复</Text></Pressable>
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
  hint: { marginTop: spacing.lg, paddingHorizontal: spacing.md, color: colors.textFaint, fontSize: 10, lineHeight: 17, textAlign: 'center' },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.overlay }, confirmCard: { width: '100%', maxWidth: 320, padding: spacing.xl, borderRadius: radii.lg, backgroundColor: colors.background },
  confirmTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 18, fontWeight: '600', textAlign: 'center' }, confirmSummary: { marginTop: spacing.md, color: colors.primary, fontSize: 11, fontWeight: '600', textAlign: 'center' }, confirmHint: { marginTop: spacing.sm, color: colors.textFaint, fontSize: 10, lineHeight: 16, textAlign: 'center' },
  confirmActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl }, confirmButton: { flex: 1, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.surfaceMuted }, restoreButton: { backgroundColor: colors.primary }, cancelText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' }, restoreText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});
