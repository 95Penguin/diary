import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import type { Entry } from '@/domain/journal';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { formatShortDateTime, formatTime } from '@/utils/date';
import { useAppPreferences } from '@/preferences/app-preferences';
import { MediaThumbnail } from '@/components/media-view';

export function EntryCard({ entry, onPress, onLongPress }: { entry: Entry; onPress: () => void; onLongPress?: () => void }) {
  const { fontScale, readingFontFamily, readingTheme } = useAppPreferences();
  const latest = entry.followUps.at(-1);
  return (
    <Pressable accessibilityRole="button" accessibilityHint={onLongPress ? '长按可编辑或删除' : undefined} delayLongPress={450} onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.rail}><View style={[styles.dot, { borderColor: readingTheme.background }]} /><View style={[styles.line, { backgroundColor: readingTheme.border }]} /></View>
      <View style={[styles.content, { borderBottomColor: readingTheme.border }]}> 
        <View style={styles.meta}><Text style={styles.time}>{formatTime(entry.occurredAt)}</Text><View style={styles.badges}>{entry.mood || entry.weather ? <Text style={[styles.mood, { color: readingTheme.secondary }]}>{[entry.mood, entry.weather].filter(Boolean).join(' · ')}</Text> : null}{entry.favoritedAt ? <SymbolView name={{ ios: 'bookmark.fill', android: 'bookmark', web: 'bookmark' }} size={14} tintColor={colors.primary} /> : null}</View></View>
        <View style={styles.summary}>
          {entry.images[0] ? <MediaThumbnail media={entry.images[0]} style={styles.thumbnail} /> : null}
          <Text numberOfLines={entry.images.length ? 3 : 5} style={[styles.body, { color: readingTheme.text, fontFamily: readingFontFamily, fontSize: 15 * fontScale, lineHeight: 23 * fontScale }]}>{entry.content}</Text>
        </View>
        {entry.locationName ? <Text numberOfLines={1} style={[styles.location, { color: readingTheme.secondary }]}>⌖ {entry.locationName}</Text> : null}
        {latest ? (
          <View style={[styles.followUp, { backgroundColor: readingTheme.surface }]}>
            <Text numberOfLines={1} style={[styles.followUpText, { color: readingTheme.secondary }]}>↳ {latest.content}</Text>
            <Text style={[styles.followUpCount, { color: readingTheme.secondary }]}>{entry.followUps.length > 1 ? `共 ${entry.followUps.length} 条` : formatShortDateTime(latest.createdAt)}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', minHeight: 72 },
  pressed: { opacity: 0.68 },
  rail: { width: 26, alignItems: 'center' },
  dot: { width: 9, height: 9, marginTop: 13, borderRadius: 5, backgroundColor: colors.primary, borderWidth: 3, borderColor: colors.primarySoft },
  line: { width: 1, flex: 1, marginTop: 4, backgroundColor: colors.border },
  content: { flex: 1, paddingTop: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  time: { color: colors.primary, fontSize: 11, fontWeight: '700' }, badges: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, mood: { color: colors.textSecondary, fontSize: 10 },
  summary: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }, body: { flex: 1, color: colors.text, fontFamily: fonts.serif, fontSize: 15, lineHeight: 23, includeFontPadding: false },
  thumbnail: { width: 68, height: 68, borderRadius: radii.sm, backgroundColor: 'transparent' },
  location: { marginTop: spacing.xs, color: colors.textFaint, fontSize: 9 },
  followUp: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 6, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radii.sm, backgroundColor: colors.surfaceMuted },
  followUpCount: { color: colors.textFaint, fontSize: 10 },
  followUpText: { flex: 1, color: colors.textSecondary, fontSize: 11, lineHeight: 16 },
});
