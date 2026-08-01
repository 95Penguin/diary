import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { showAppDialog } from '@/components/app-dialog-host';
import { getEntry } from '@/database/journal-repository';
import type { Entry } from '@/domain/journal';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { formatFullDate, formatShortDateTime } from '@/utils/date';
import { shareCardFile } from '@/utils/share-card-file';
import { SHARE_CARD_CONTENT_LIMIT, shareCardImageUri, shareCardText } from '@/utils/share-card';

type Option = 'image' | 'location' | 'tags' | 'followUps';

export default function ShareCardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const { readingTheme } = useAppPreferences();
  const cardRef = useRef<View>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [options, setOptions] = useState<Record<Option, boolean>>({ image: true, location: false, tags: false, followUps: false });

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    void getEntry(db, id).then((item) => { if (active) { setEntry(item); setLoading(false); } });
    return () => { active = false; };
  }, [db, id]));

  function toggle(key: Option) {
    setOptions((current) => ({ ...current, [key]: !current[key] }));
  }

  async function share() {
    if (!cardRef.current || sharing) return;
    setSharing(true);
    try {
      const uri = await captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile' });
      await shareCardFile(uri);
    } catch {
      await showAppDialog({ title: '生成失败', message: '分享卡片暂时没有生成，请稍后再试。' });
    } finally { setSharing(false); }
  }

  if (loading) return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}><ActivityIndicator color={colors.primary} style={styles.center} /></SafeAreaView>;
  if (!entry) return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}><View style={styles.center}><Text style={{ color: readingTheme.text }}>记录不存在</Text><Pressable onPress={() => router.back()}><Text style={styles.backLink}>返回</Text></Pressable></View></SafeAreaView>;

  const imageUri = options.image ? shareCardImageUri(entry) : null;
  return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}><Pressable accessibilityLabel="返回" hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable><Text style={[styles.title, { color: readingTheme.text }]}>分享卡片</Text><View style={styles.headerSpace} /></View>
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <Text style={[styles.hint, { color: readingTheme.secondary }]}>预览中只会出现你主动选择的信息</Text>
      <View collapsable={false} ref={cardRef} style={styles.card}>
        <View style={styles.cardTop}><Text style={styles.brand}>拾时</Text><Text style={styles.date}>{formatFullDate(entry.occurredAt)}</Text></View>
        {imageUri ? <Image source={imageUri} contentFit="cover" style={styles.hero} /> : null}
        <Text style={styles.content}>{shareCardText(entry.content)}</Text>
        {options.location && entry.locationName ? <Text style={styles.metadata}>⌖ {entry.locationName}</Text> : null}
        {options.tags && entry.tags.length ? <Text style={styles.metadata}>{entry.tags.map((tag) => `#${tag}`).join('　')}</Text> : null}
        {options.followUps && entry.followUps.length ? <View style={styles.followUps}><Text style={styles.followTitle}>后来</Text>{entry.followUps.slice(0, 3).map((item) => <View key={item.id} style={styles.followItem}><Text style={styles.followTime}>{formatShortDateTime(item.createdAt)}</Text><Text style={styles.followText}>{shareCardText(item.content, 100)}</Text></View>)}{entry.followUps.length > 3 ? <Text style={styles.more}>另有 {entry.followUps.length - 3} 条后续</Text> : null}</View> : null}
        <View style={styles.signature}><View style={styles.signatureLine} /><Text style={styles.signatureText}>把日子慢慢收好</Text></View>
      </View>
      <Text style={[styles.optionsTitle, { color: readingTheme.secondary }]}>卡片内容</Text>
      <View style={styles.options}>
        <Choice label="首张图片" enabled={options.image} unavailable={!shareCardImageUri(entry)} onPress={() => toggle('image')} />
        <Choice label="地点" enabled={options.location} unavailable={!entry.locationName} onPress={() => toggle('location')} />
        <Choice label="标签" enabled={options.tags} unavailable={!entry.tags.length} onPress={() => toggle('tags')} />
        <Choice label="后续" enabled={options.followUps} unavailable={!entry.followUps.length} onPress={() => toggle('followUps')} />
      </View>
      <Text style={[styles.privacy, { color: readingTheme.secondary }]}>地点、标签和后续默认隐藏。正文超过 {SHARE_CARD_CONTENT_LIMIT} 字时，卡片只展示开头，原记录不会改变。</Text>
      <Pressable disabled={sharing} onPress={() => void share()} style={[styles.shareButton, sharing && styles.disabled]}>{sharing ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.shareText}>生成图片并分享</Text>}</Pressable>
    </ScrollView>
  </SafeAreaView>;
}

function Choice({ label, enabled, unavailable, onPress }: { label: string; enabled: boolean; unavailable: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: enabled, disabled: unavailable }} disabled={unavailable} onPress={onPress} style={[styles.choice, enabled && styles.choiceActive, unavailable && styles.choiceUnavailable]}><Text style={[styles.choiceText, enabled && styles.choiceTextActive]}>{enabled ? '✓ ' : ''}{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, backLink: { marginTop: spacing.md, color: colors.primary },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth }, back: { color: colors.primary, fontSize: 13 }, title: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, headerSpace: { width: 42 },
  scroll: { alignItems: 'center', padding: spacing.xl, paddingBottom: spacing.xxxl }, hint: { alignSelf: 'stretch', marginBottom: spacing.md, fontSize: 11, textAlign: 'center' },
  card: { width: 340, overflow: 'hidden', padding: spacing.xxl, borderRadius: radii.lg, backgroundColor: '#FFFDF8', shadowColor: '#22332B', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 7 }, elevation: 4 },
  cardTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }, brand: { color: colors.primary, fontFamily: fonts.serif, fontSize: 18, fontWeight: '700', letterSpacing: 2 }, date: { color: colors.textSecondary, fontSize: 10 },
  hero: { width: '100%', height: 190, marginTop: spacing.lg, borderRadius: radii.md, backgroundColor: colors.surfaceMuted }, content: { marginTop: spacing.xl, color: colors.text, fontFamily: fonts.serif, fontSize: 16, lineHeight: 27, letterSpacing: 0.35 }, metadata: { marginTop: spacing.md, color: colors.textSecondary, fontSize: 10, lineHeight: 17 },
  followUps: { marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, followTitle: { color: colors.primary, fontFamily: fonts.serif, fontSize: 13, fontWeight: '700' }, followItem: { marginTop: spacing.sm }, followTime: { color: colors.textFaint, fontSize: 9 }, followText: { marginTop: 2, color: colors.textSecondary, fontSize: 11, lineHeight: 18 }, more: { marginTop: spacing.sm, color: colors.textFaint, fontSize: 9 },
  signature: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xxl }, signatureLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border }, signatureText: { color: colors.textFaint, fontSize: 9, letterSpacing: 1 },
  optionsTitle: { alignSelf: 'stretch', marginTop: spacing.xxl, marginBottom: spacing.sm, fontSize: 11 }, options: { alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, choice: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.pill, backgroundColor: colors.surface }, choiceActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft }, choiceUnavailable: { opacity: 0.35 }, choiceText: { color: colors.textSecondary, fontSize: 11 }, choiceTextActive: { color: colors.primary, fontWeight: '700' },
  privacy: { alignSelf: 'stretch', marginTop: spacing.lg, fontSize: 10, lineHeight: 17 }, shareButton: { alignSelf: 'stretch', minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xl, borderRadius: radii.md, backgroundColor: colors.primary }, shareText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' }, disabled: { opacity: 0.5 },
});
