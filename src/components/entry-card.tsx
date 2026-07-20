import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import type { Entry } from '@/domain/journal';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { formatShortDateTime, formatTime } from '@/utils/date';

export function EntryCard({ entry, onPress }: { entry: Entry; onPress: () => void }) {
  const latest = entry.followUps.at(-1);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.rail}><View style={styles.dot} /><View style={styles.line} /></View>
      <View style={styles.content}>
        <Text style={styles.time}>{formatTime(entry.occurredAt)}</Text>
        <View style={styles.summary}>
          {entry.images[0] ? <Image source={entry.images[0].uri} contentFit="cover" style={styles.thumbnail} /> : null}
          <Text numberOfLines={entry.images.length ? 3 : undefined} style={styles.body}>{entry.content}</Text>
        </View>
        {latest ? (
          <View style={styles.followUp}>
            <Text numberOfLines={1} style={styles.followUpText}>↳ {latest.content}</Text>
            <Text style={styles.followUpCount}>{entry.followUps.length > 1 ? `共 ${entry.followUps.length} 条` : formatShortDateTime(latest.createdAt)}</Text>
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
  time: { color: colors.primary, fontSize: 11, fontWeight: '700', marginBottom: spacing.xs },
  summary: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }, body: { flex: 1, color: colors.text, fontFamily: fonts.serif, fontSize: 15, lineHeight: 23, includeFontPadding: false },
  thumbnail: { width: 68, height: 68, borderRadius: radii.sm, backgroundColor: colors.surfaceMuted },
  followUp: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 6, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radii.sm, backgroundColor: colors.surfaceMuted },
  followUpCount: { color: colors.textFaint, fontSize: 10 },
  followUpText: { flex: 1, color: colors.textSecondary, fontSize: 11, lineHeight: 16 },
});
