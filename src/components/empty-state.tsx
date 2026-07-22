import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, spacing } from '@/theme/tokens';
import { useAppPreferences } from '@/preferences/app-preferences';

export function EmptyState({ title, description }: { title: string; description: string }) {
  const { readingTheme } = useAppPreferences();
  return <View style={styles.container}><Text style={styles.symbol}>◌</Text><Text style={[styles.title, { color: readingTheme.text }]}>{title}</Text><Text style={[styles.description, { color: readingTheme.secondary }]}>{description}</Text></View>;
}
const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxxl, paddingVertical: 90 },
  symbol: { color: colors.primary, fontSize: 42 },
  title: { marginTop: spacing.md, color: colors.text, fontFamily: fonts.serif, fontSize: 18 },
  description: { marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, lineHeight: 20, textAlign: 'center' },
});
