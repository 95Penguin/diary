import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

type DialogAction = { label: string; onPress: () => void | Promise<void>; tone?: 'primary' | 'danger' | 'neutral' };

export function AppDialog({ visible, title, message, actions, onClose }: { visible: boolean; title: string; message?: string; actions: DialogAction[]; onClose: () => void }) {
  const { readingTheme } = useAppPreferences();
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <Pressable accessibilityLabel="关闭弹窗" onPress={onClose} style={styles.overlay}><Pressable onPress={(event) => event.stopPropagation()} style={[styles.card, { backgroundColor: readingTheme.background }]}>
      <Text style={[styles.title, { color: readingTheme.text }]}>{title}</Text>
      {message ? <Text style={[styles.message, { color: readingTheme.secondary }]}>{message}</Text> : null}
      <View style={styles.actions}>{actions.map((action) => <Pressable key={action.label} onPress={() => void action.onPress()} style={({ pressed }) => [styles.button, { backgroundColor: action.tone === 'primary' ? colors.primarySoft : readingTheme.surface }, pressed && styles.pressed]}><Text style={[styles.buttonText, { color: action.tone === 'danger' ? colors.danger : action.tone === 'primary' ? colors.primary : readingTheme.secondary }]}>{action.label}</Text></Pressable>)}</View>
    </Pressable></Pressable>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.overlay },
  card: { width: '100%', maxWidth: 300, padding: spacing.xl, borderRadius: radii.lg },
  title: { fontFamily: fonts.serif, fontSize: 18, lineHeight: 26, fontWeight: '600', textAlign: 'center', includeFontPadding: false },
  message: { marginTop: spacing.sm, fontSize: 11, lineHeight: 18, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  button: { flex: 1, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md },
  buttonText: { fontSize: 12, fontWeight: '700' }, pressed: { opacity: 0.58 },
});
