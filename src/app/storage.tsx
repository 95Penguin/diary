import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';

import { showAppDialog } from '@/components/app-dialog-host';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { formatFileSize } from '@/utils/media-file-info';
import { backfillImageThumbnails, clearImageThumbnailCache } from '@/utils/image-thumbnail-cache';
import { backfillVideoThumbnails } from '@/utils/video-thumbnail-cache';
import { getMediaStorageReport } from '@/utils/media-storage-report';

type Report = Awaited<ReturnType<typeof getMediaStorageReport>>;
export default function StorageScreen() {
  const db = useSQLiteContext(); const { readingTheme } = useAppPreferences();
  const [report, setReport] = useState<Report | null>(null); const [clearing, setClearing] = useState(false); const [rebuilding, setRebuilding] = useState(false);
  const load = useCallback(() => { void getMediaStorageReport(db).then(setReport); }, [db]);
  useFocusEffect(load);
  async function clearCache() {
    if (!report?.thumbnailBytes || clearing) return;
    const decision = await showAppDialog({ title: '仅清理缩略图缓存？', message: `将释放约 ${formatFileSize(report.thumbnailBytes)}。原始图片和视频不会删除，需要时会在后台重新生成。`, actions: [{ label: '取消', value: 'cancel' }, { label: '清理缓存', value: 'clear', tone: 'primary' }] });
    if (decision !== 'clear') return;
    setClearing(true);
    try {
      await clearImageThumbnailCache(db);
      await getMediaStorageReport(db).then(setReport);
      setRebuilding(true);
      await backfillImageThumbnails(db);
      await backfillVideoThumbnails(db);
      await getMediaStorageReport(db).then(setReport);
    } catch {
      await showAppDialog({ title: '缓存清理失败', message: '原始图片和视频没有受到影响，请稍后重试。' });
    } finally { setClearing(false); setRebuilding(false); }
  }
  return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}><View style={[styles.header, { borderBottomColor: readingTheme.border }]}><Pressable onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable><Text style={[styles.title, { color: readingTheme.text }]}>存储空间</Text><View style={styles.space} /></View>{!report ? <ActivityIndicator style={styles.loading} color={colors.primary} /> : <View style={styles.body}><Text style={[styles.total, { color: readingTheme.text }]}>{formatFileSize(report.totalBytes)}</Text><Text style={[styles.caption, { color: readingTheme.secondary }]}>{report.mediaCount} 个媒体保存在本机</Text><View style={[styles.card, { backgroundColor: readingTheme.surface }]}><Row label="原始图片" value={report.imageBytes} /><Row label="原始视频" value={report.videoBytes} /><Row label="缩略图缓存" value={report.thumbnailBytes} /></View>{report.missing ? <Text style={styles.warning}>发现 {report.missing} 个原文件缺失，可前往媒体详情处理。</Text> : null}{rebuilding ? <Text style={[styles.rebuilding, { color: readingTheme.secondary }]}>正在恢复预览缩略图，原始媒体不受影响…</Text> : null}<Pressable disabled={!report.thumbnailBytes || clearing} onPress={() => void clearCache()} style={[styles.button, (!report.thumbnailBytes || clearing) && styles.disabled]}><Text style={styles.buttonText}>{rebuilding ? '正在恢复预览…' : clearing ? '正在清理…' : '仅清理缓存'}</Text></Pressable><Text style={[styles.note, { color: readingTheme.secondary }]}>清理只删除用于列表快速显示的小图，不会触碰原图、视频、记录或备份。</Text></View>}</SafeAreaView>;
}
function Row({ label, value }: { label: string; value: number }) { const { readingTheme } = useAppPreferences(); return <View style={styles.row}><Text style={[styles.rowLabel, { color: readingTheme.text }]}>{label}</Text><Text style={[styles.rowValue, { color: readingTheme.secondary }]}>{formatFileSize(value)}</Text></View>; }
const styles = StyleSheet.create({ safe:{flex:1}, header:{height:52,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:spacing.xl,borderBottomWidth:StyleSheet.hairlineWidth},back:{color:colors.primary,fontSize:13},title:{fontFamily:fonts.serif,fontSize:17,fontWeight:'600'},space:{width:42},loading:{flex:1},body:{padding:spacing.xl},total:{marginTop:spacing.lg,fontFamily:fonts.serif,fontSize:34,fontWeight:'700'},caption:{marginTop:4,fontSize:12},card:{marginTop:spacing.xxl,paddingHorizontal:spacing.lg,borderRadius:radii.md},row:{minHeight:54,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#00000010'},rowLabel:{fontSize:13},rowValue:{fontSize:12},warning:{marginTop:spacing.lg,color:colors.danger,fontSize:11,lineHeight:18},rebuilding:{marginTop:spacing.lg,fontSize:11,lineHeight:18},button:{minHeight:46,alignItems:'center',justifyContent:'center',marginTop:spacing.xxl,borderRadius:radii.pill,backgroundColor:colors.primary},buttonText:{color:'#fff',fontSize:13,fontWeight:'700'},disabled:{opacity:.45},note:{marginTop:spacing.md,fontSize:10,lineHeight:17,textAlign:'center'} });
