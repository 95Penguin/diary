import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { File } from 'expo-file-system';

import { createJournalExport, saveLastExportAt } from '@/database/journal-repository';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { createZipBackupFile, inspectZipBackupFile } from '@/utils/backup-zip';
import { withBackupOperation } from '@/utils/backup-operation';
import { formatShortDateTime } from '@/utils/date';
import { recordAppError } from '@/utils/app-error-log';
import { AppDialog } from '@/components/app-dialog';
import { clearWebDavPassword, getWebDavPassword, saveWebDavPassword } from '@/utils/webdav-credentials';
import { deleteWebDavBackup, downloadWebDavBackup, listWebDavBackups, testWebDavConnection, uploadWebDavBackup, type WebDavBackupFile, type WebDavConfig } from '@/utils/webdav';

function errorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  if (code === 'webdav-invalid-url') return '服务器地址格式不正确';
  if (code === 'webdav-https-required') return '为保护账号，只支持 HTTPS 地址';
  if (code === 'webdav-credentials-required') return '请填写账号和应用密码';
  if (code === 'webdav-auth-failed') return '账号或应用密码不正确';
  if (code === 'webdav-forbidden') return '当前账号没有访问或写入权限';
  if (code === 'webdav-storage-full') return '云盘空间不足';
  if (code.startsWith('webdav-upload-failed') || code === 'webdav-network-error') return '上传连接中断，已自动重试；请保持应用在前台并检查网络';
  if (code === 'webdav-download-failed') return '云端备份下载失败，请检查网络后重试';
  if (code === 'webdav-size-mismatch') return '上传后的文件大小不一致，已停止本次备份';
  if (code === 'webdav-invalid-manifest' || code === 'webdav-segment-mismatch') return '云端分卷不完整或已损坏，无法恢复';
  if (code.startsWith('webdav-http-')) return `服务器返回异常状态（${code.slice(12)}）`;
  return '操作失败，请稍后重试';
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function WebDavBackupScreen() {
  const db = useSQLiteContext();
  const { preferences, readingTheme, updatePreferences } = useAppPreferences();
  const [serverUrl, setServerUrl] = useState(preferences.webDavServerUrl);
  const [username, setUsername] = useState(preferences.webDavUsername);
  const [directory, setDirectory] = useState(preferences.webDavDirectory || '拾时备份');
  const [password, setPassword] = useState('');
  const [passwordLoaded, setPasswordLoaded] = useState(false);
  const [working, setWorking] = useState<'test' | 'upload' | null>(null);
  const [message, setMessage] = useState('');
  const [cloudFiles, setCloudFiles] = useState<WebDavBackupFile[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<WebDavBackupFile | null>(null);

  useEffect(() => {
    let active = true;
    void getWebDavPassword()
      .then((value) => { if (active) setPassword(value); })
      .catch((error) => {
        void recordAppError('webdav.read-credentials', error);
        if (active) setMessage('无法读取系统中保存的 WebDAV 密码，请重新填写');
      })
      .finally(() => { if (active) setPasswordLoaded(true); });
    return () => { active = false; };
  }, []);

  function config(): WebDavConfig {
    return { serverUrl, username, password, directory };
  }

  async function refreshList(silent = false) {
    if (!password) return;
    if (!silent) setListLoading(true);
    try { setCloudFiles(await listWebDavBackups(config())); }
    catch (error) { if (!silent) setMessage(errorMessage(error)); }
    finally { if (!silent) setListLoading(false); }
  }

  async function persistConfig(lastWebDavBackupAt = preferences.lastWebDavBackupAt) {
    await Promise.all([
      updatePreferences({
        webDavServerUrl: serverUrl.trim(),
        webDavUsername: username.trim(),
        webDavDirectory: directory.trim() || '拾时备份',
        lastWebDavBackupAt,
      }),
      saveWebDavPassword(password),
    ]);
  }

  async function testConnection() {
    if (working) return;
    setWorking('test'); setMessage('');
    try {
      await testWebDavConnection(config());
      await persistConfig();
      setMessage('连接成功，云端备份目录已经可以使用');
      await refreshList(true);
    } catch (error) {
      void recordAppError('webdav.connection-test', new Error(error instanceof Error ? error.message : 'webdav-unknown'));
      setMessage(errorMessage(error));
    } finally { setWorking(null); }
  }

  async function uploadBackup() {
    if (working) return;
    setWorking('upload'); setMessage('正在整理并验证完整备份…');
    try {
      await persistConfig();
      const completed = await withBackupOperation(async () => {
        const source = await createJournalExport(db);
        const archive = await createZipBackupFile(source);
        try {
          const inspected = await inspectZipBackupFile(archive.uri);
          if (inspected.entries.length !== source.entries.length || inspected.followUps.length !== source.followUps.length) throw new Error('backup-verification-failed');
          setMessage('备份已验证，正在上传到云盘…');
          const now = new Date().toISOString();
          const stamp = `${now.replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}-${now.slice(20, 23)}`;
          let displayedProgress = -1;
          const result = await uploadWebDavBackup(config(), archive.uri, `拾时云备份-${stamp}.zip`, (sent, total) => {
            const percent = Math.min(99, Math.floor((sent / Math.max(total, 1)) * 100));
            if (percent >= displayedProgress + 5) {
              displayedProgress = percent;
              setMessage(`正在上传到云盘… ${percent}%`);
            }
          });
          if (preferences.webDavBackupRetention) {
            try {
              const files = await listWebDavBackups(config());
              for (const file of files.slice(preferences.webDavBackupRetention)) await deleteWebDavBackup(config(), file.filename, file.segmented);
            } catch (error) { void recordAppError('webdav.retention-cleanup', new Error(error instanceof Error ? error.message : 'webdav-unknown')); }
          }
          return { archive, now, result };
        } finally {
          if (archive.uri.startsWith('file://')) {
            try { const file = new File(archive.uri); if (file.exists) file.delete(); } catch { /* Cache cleanup is best-effort. */ }
          }
        }
      });
      await saveLastExportAt(db, completed.now);
      await updatePreferences({ lastWebDavBackupAt: completed.now, lastBackupCheckAt: completed.now, lastBackupHealth: completed.archive.missingMedia ? 'warning' : 'healthy' });
      setMessage(completed.archive.missingMedia
        ? `已上传 ${formatBytes(completed.result.size)}，但有 ${completed.archive.missingMedia} 个本地媒体文件缺失`
        : `云备份完成：${completed.result.filename}（${formatBytes(completed.result.size)}）`);
      await refreshList(true);
    } catch (error) {
      void recordAppError('webdav.upload', new Error(error instanceof Error ? error.message : 'webdav-unknown'));
      setMessage(error instanceof Error && error.message === 'backup-verification-failed' ? '本地备份验证失败，未上传任何文件' : errorMessage(error));
    } finally { setWorking(null); }
  }

  async function restoreCloudBackup(file: WebDavBackupFile) {
    if (working) return;
    setWorking('upload'); setMessage('正在下载并验证云端备份…');
    let downloadedUri: string | null = null;
    try {
      const downloaded = await downloadWebDavBackup(config(), file.filename, file.segmented);
      downloadedUri = downloaded.uri;
      await inspectZipBackupFile(downloaded.uri);
      router.push({ pathname: '/backup', params: { cloudBackupUri: downloaded.uri } });
      downloadedUri = null;
    } catch (error) {
      if (downloadedUri?.startsWith('file://')) {
        try { const downloaded = new File(downloadedUri); if (downloaded.exists) downloaded.delete(); } catch { /* Cache cleanup is best-effort. */ }
      }
      void recordAppError('webdav.download', new Error(error instanceof Error ? error.message : 'webdav-unknown'));
      setMessage(errorMessage(error));
    } finally { setWorking(null); }
  }

  async function removeCloudBackup() {
    if (!pendingDelete || working) return;
    const target = pendingDelete;
    setPendingDelete(null); setWorking('upload');
    try {
      await deleteWebDavBackup(config(), target.filename, target.segmented);
      setCloudFiles((items) => items.filter((item) => item.filename !== target.filename));
      setMessage('云端备份已删除');
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setWorking(null); }
  }

  async function clearSettings() {
    if (working) return;
    try {
      await clearWebDavPassword();
      await updatePreferences({ webDavServerUrl: '', webDavUsername: '', webDavDirectory: '拾时备份', lastWebDavBackupAt: null, automaticWebDavBackupEnabled: false });
      setServerUrl(''); setUsername(''); setPassword(''); setDirectory('拾时备份');
      setMessage('WebDAV 账号设置已从本机清除，云端文件不会删除');
    } catch (error) {
      void recordAppError('webdav.clear-settings', error);
      setMessage('清除设置失败，请稍后重试');
    }
  }

  async function toggleAutomaticBackup() {
    if (!preferences.automaticWebDavBackupEnabled && (!serverUrl.trim() || !username.trim() || !password)) {
      setMessage('请先填写账号、应用密码并测试连接');
      return;
    }
    try {
      await persistConfig();
      await updatePreferences({ automaticWebDavBackupEnabled: !preferences.automaticWebDavBackupEnabled });
      setMessage(preferences.automaticWebDavBackupEnabled ? '自动云备份已关闭' : '自动云备份已开启，将在打开应用时按频率检查');
    } catch (error) {
      void recordAppError('webdav.toggle-automatic', error);
      setMessage('自动备份设置保存失败，请稍后重试');
    }
  }

  return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]} edges={['top', 'bottom']}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}><Pressable hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable><Text style={[styles.title, { color: readingTheme.text }]}>WebDAV 云备份</Text><View style={styles.headerSpace} /></View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Text style={[styles.sectionTitle, styles.firstSectionTitle, { color: readingTheme.secondary }]}>云盘账号</Text>
      <View style={[styles.form, { backgroundColor: readingTheme.surface }]}>
        <Text style={[styles.label, { color: readingTheme.secondary }]}>WebDAV 服务器</Text><TextInput autoCapitalize="none" autoCorrect={false} keyboardType="url" value={serverUrl} onChangeText={setServerUrl} placeholder="https://dav.example.com/dav/" placeholderTextColor={readingTheme.secondary} style={[styles.input, { color: readingTheme.text, borderColor: readingTheme.border }]} />
        <Text style={[styles.label, { color: readingTheme.secondary }]}>账号</Text><TextInput autoCapitalize="none" autoCorrect={false} value={username} onChangeText={setUsername} placeholder="WebDAV 账号" placeholderTextColor={readingTheme.secondary} style={[styles.input, { color: readingTheme.text, borderColor: readingTheme.border }]} />
        <Text style={[styles.label, { color: readingTheme.secondary }]}>应用密码</Text><TextInput editable={passwordLoaded} autoCapitalize="none" autoCorrect={false} secureTextEntry value={password} onChangeText={setPassword} placeholder={passwordLoaded ? 'WebDAV 应用密码' : '正在读取…'} placeholderTextColor={readingTheme.secondary} style={[styles.input, { color: readingTheme.text, borderColor: readingTheme.border }]} />
        <Text style={[styles.label, { color: readingTheme.secondary }]}>云端目录</Text><TextInput autoCapitalize="none" autoCorrect={false} value={directory} onChangeText={setDirectory} placeholder="拾时备份" placeholderTextColor={readingTheme.secondary} style={[styles.input, { color: readingTheme.text, borderColor: readingTheme.border }]} />
        <Text style={[styles.securityHint, { color: readingTheme.secondary }]}>密码保存在系统加密存储中，不会写入数据库、备份或诊断信息。</Text>
      </View>
      <Pressable disabled={Boolean(working) || !passwordLoaded} onPress={() => void testConnection()} style={({ pressed }) => [styles.secondaryButton, { borderColor: readingTheme.border }, (pressed || working) && styles.pressed]}>{working === 'test' ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.secondaryText}>保存并测试连接</Text>}</Pressable>
      <Pressable disabled={Boolean(working) || !passwordLoaded} onPress={() => void uploadBackup()} style={({ pressed }) => [styles.primaryButton, (pressed || working) && styles.pressed]}>{working === 'upload' ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>立即备份到云端</Text>}</Pressable>
      {preferences.lastWebDavBackupAt ? <Text style={[styles.lastBackup, { color: readingTheme.secondary }]}>最近成功：{formatShortDateTime(preferences.lastWebDavBackupAt)}</Text> : null}
      {message ? <Text style={[styles.message, { color: message.includes('失败') || message.includes('不正确') || message.includes('不足') ? colors.danger : colors.primary }]}>{message}</Text> : null}
      <Text style={[styles.sectionTitle, { color: readingTheme.secondary }]}>自动备份</Text>
      <Pressable accessibilityRole="switch" accessibilityState={{ checked: preferences.automaticWebDavBackupEnabled }} onPress={() => void toggleAutomaticBackup()} style={[styles.settingRow, { backgroundColor: readingTheme.surface }]}><View style={styles.settingCopy}><Text style={[styles.settingTitle, { color: readingTheme.text }]}>自动云备份</Text><Text style={[styles.settingHint, { color: readingTheme.secondary }]}>打开应用或回到前台时检查，不会自动恢复</Text></View><View style={[styles.switchTrack, preferences.automaticWebDavBackupEnabled && styles.switchTrackActive]}><View style={[styles.switchThumb, preferences.automaticWebDavBackupEnabled && styles.switchThumbActive]} /></View></Pressable>
      <Pressable accessibilityRole="switch" accessibilityState={{ checked: preferences.webDavWifiOnly }} onPress={() => void updatePreferences({ webDavWifiOnly: !preferences.webDavWifiOnly })} style={[styles.settingRow, { backgroundColor: readingTheme.surface }]}><View style={styles.settingCopy}><Text style={[styles.settingTitle, { color: readingTheme.text }]}>仅 Wi‑Fi 上传</Text><Text style={[styles.settingHint, { color: readingTheme.secondary }]}>关闭后可能消耗较多移动流量</Text></View><View style={[styles.switchTrack, preferences.webDavWifiOnly && styles.switchTrackActive]}><View style={[styles.switchThumb, preferences.webDavWifiOnly && styles.switchThumbActive]} /></View></Pressable>
      <View style={[styles.choiceCard, { backgroundColor: readingTheme.surface }]}><Text style={[styles.settingTitle, { color: readingTheme.text }]}>备份频率</Text><View style={styles.choices}>{([1, 3, 7] as const).map((days) => <Pressable key={days} onPress={() => void updatePreferences({ webDavBackupIntervalDays: days })} style={[styles.choice, preferences.webDavBackupIntervalDays === days && styles.choiceActive]}><Text style={[styles.choiceText, preferences.webDavBackupIntervalDays === days && styles.choiceTextActive]}>{days === 1 ? '每天' : `${days} 天`}</Text></Pressable>)}</View></View>
      <View style={[styles.choiceCard, { backgroundColor: readingTheme.surface }]}><Text style={[styles.settingTitle, { color: readingTheme.text }]}>云端保留</Text><View style={styles.choices}>{([5, 10, 20, 0] as const).map((count) => <Pressable key={count} onPress={() => void updatePreferences({ webDavBackupRetention: count })} style={[styles.choice, preferences.webDavBackupRetention === count && styles.choiceActive]}><Text style={[styles.choiceText, preferences.webDavBackupRetention === count && styles.choiceTextActive]}>{count ? `${count} 份` : '不清理'}</Text></Pressable>)}</View></View>
      <View style={styles.cloudHeader}><Text style={[styles.sectionTitle, styles.cloudTitle, { color: readingTheme.secondary }]}>云端备份</Text><Pressable disabled={listLoading || Boolean(working)} onPress={() => void refreshList()}><Text style={styles.refreshText}>{listLoading ? '读取中…' : '刷新'}</Text></Pressable></View>
      {cloudFiles.length ? <View style={styles.cloudList}>{cloudFiles.map((file) => <View key={file.filename} style={[styles.cloudRow, { backgroundColor: readingTheme.surface }]}><View style={styles.cloudCopy}><Text numberOfLines={1} style={[styles.cloudName, { color: readingTheme.text }]}>{file.filename}</Text><Text style={[styles.cloudMeta, { color: readingTheme.secondary }]}>{formatBytes(file.size)}{file.segmented ? ' · 分卷备份' : ''}{file.modifiedAt ? ` · ${formatShortDateTime(file.modifiedAt)}` : ''}</Text></View><Pressable disabled={Boolean(working)} onPress={() => void restoreCloudBackup(file)} style={styles.cloudAction}><Text style={styles.cloudActionText}>验证恢复</Text></Pressable><Pressable disabled={Boolean(working)} hitSlop={8} onPress={() => setPendingDelete(file)}><Text style={styles.deleteText}>删除</Text></Pressable></View>)}</View> : <Text style={[styles.emptyCloud, { color: readingTheme.secondary }]}>{passwordLoaded && password ? '点击“刷新”查看云端备份' : '设置并测试连接后即可查看'}</Text>}
      <Pressable disabled={Boolean(working)} onPress={() => void clearSettings()} style={styles.clearButton}><Text style={[styles.clearText, { color: readingTheme.secondary }]}>清除本机 WebDAV 设置</Text></Pressable>
    </ScrollView>
    <AppDialog visible={Boolean(pendingDelete)} title="删除这份云端备份？" message={pendingDelete?.filename} onClose={() => setPendingDelete(null)} actions={[{ label: '取消', onPress: () => setPendingDelete(null) }, { label: '删除', tone: 'danger', onPress: () => void removeCloudBackup() }]} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth }, back: { color: colors.primary, fontSize: 13 }, title: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, headerSpace: { width: 42 },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.xxxl }, sectionTitle: { marginTop: spacing.xl, marginBottom: spacing.sm, fontSize: 11 }, firstSectionTitle: { marginTop: 0 }, form: { padding: spacing.lg, borderRadius: radii.lg }, label: { marginTop: spacing.sm, marginBottom: 5, fontSize: 11 }, input: { height: 44, paddingHorizontal: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, fontSize: 12 }, securityHint: { marginTop: spacing.md, fontSize: 10, lineHeight: 16 },
  secondaryButton: { height: 44, alignItems: 'center', justifyContent: 'center', marginTop: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.pill }, secondaryText: { color: colors.primary, fontSize: 12, fontWeight: '700' }, primaryButton: { height: 46, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.primary }, primaryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' }, pressed: { opacity: 0.62 }, lastBackup: { marginTop: spacing.md, fontSize: 11, textAlign: 'center' }, message: { marginTop: spacing.sm, fontSize: 11, lineHeight: 17, textAlign: 'center' }, clearButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xl }, clearText: { fontSize: 11 },
  cloudHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xl, marginBottom: spacing.sm }, cloudTitle: { marginTop: 0, marginBottom: 0 }, refreshText: { color: colors.primary, fontSize: 11, fontWeight: '700' }, cloudList: { gap: spacing.sm }, cloudRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radii.md }, cloudCopy: { flex: 1, minWidth: 0 }, cloudName: { fontSize: 11, fontWeight: '600' }, cloudMeta: { marginTop: 3, fontSize: 10 }, cloudAction: { minHeight: 32, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.primarySoft }, cloudActionText: { color: colors.primary, fontSize: 10, fontWeight: '700' }, deleteText: { color: colors.danger, fontSize: 10 }, emptyCloud: { paddingVertical: spacing.lg, textAlign: 'center', fontSize: 11 },
  settingRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radii.md }, settingCopy: { flex: 1 }, settingTitle: { fontSize: 12, fontWeight: '600' }, settingHint: { marginTop: 3, fontSize: 10, lineHeight: 15 }, switchTrack: { width: 44, height: 26, justifyContent: 'center', paddingHorizontal: 3, borderRadius: 13, backgroundColor: colors.border }, switchTrackActive: { backgroundColor: colors.primary }, switchThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF' }, switchThumbActive: { alignSelf: 'flex-end' }, choiceCard: { marginBottom: spacing.sm, padding: spacing.md, borderRadius: radii.md }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }, choice: { minHeight: 30, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radii.pill, backgroundColor: colors.background }, choiceActive: { backgroundColor: colors.primary }, choiceText: { color: colors.primary, fontSize: 10, fontWeight: '600' }, choiceTextActive: { color: '#FFFFFF' },
});
