import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, spacing } from '@/theme/tokens';

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <View style={styles.container}><Text style={styles.symbol}>◌</Text><Text style={styles.title}>{title}</Text><Text style={styles.description}>{description}</Text></View>;
}
const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxxl, paddingVertical: 90 },
  symbol: { color: colors.primary, fontSize: 42 },
  title: { marginTop: spacing.md, color: colors.text, fontFamily: fonts.serif, fontSize: 18 },
  description: { marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, lineHeight: 20, textAlign: 'center' },
});
