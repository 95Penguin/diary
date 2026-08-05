import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

type DialogAction = { label: string; onPress: () => void | Promise<void>; tone?: 'primary' | 'danger' | 'neutral' };

export function AppDialog({ visible, title, message, actions, onClose }: { visible: boolean; title: string; message?: string; actions: DialogAction[]; onClose: () => void }) {
  const { readingTheme } = useAppPreferences();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState(false);
  const pendingRef = useRef(false);

  async function runAction(action: DialogAction) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPendingAction(action.label);
    setActionError(false);
    try { await action.onPress(); }
    catch { setActionError(true); }
    finally { pendingRef.current = false; setPendingAction(null); }
  }

  function close() {
    if (pendingRef.current) return;
    setActionError(false);
    onClose();
  }

  return <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
    <Pressable accessibilityLabel="关闭弹窗" onPress={close} style={styles.overlay}><Pressable accessibilityViewIsModal onPress={(event) => event.stopPropagation()} style={[styles.card, { backgroundColor: readingTheme.background }]}>
      <Text style={[styles.title, { color: readingTheme.text }]}>{title}</Text>
      {message ? <Text style={[styles.message, { color: readingTheme.secondary }]}>{message}</Text> : null}
      {actionError ? <Text accessibilityRole="alert" style={styles.error}>操作未完成，请稍后重试。</Text> : null}
      <View style={[styles.actions, actions.length > 2 && styles.actionsVertical]}>{actions.map((action) => {
        const primary = action.tone === 'primary';
        const pending = pendingAction === action.label;
        return <Pressable accessibilityState={{ disabled: Boolean(pendingAction), busy: pending }} disabled={Boolean(pendingAction)} key={action.label} onPress={() => void runAction(action)} style={({ pressed }) => [styles.button, actions.length > 2 && styles.buttonVertical, { backgroundColor: primary ? colors.primary : readingTheme.surface }, (pressed || pendingAction) && styles.pressed]}>{pending ? <ActivityIndicator size="small" color={primary ? '#FFFFFF' : colors.primary} /> : <Text style={[styles.buttonText, { color: action.tone === 'danger' ? colors.danger : primary ? '#FFFFFF' : readingTheme.text }]}>{action.label}</Text>}</Pressable>;
      })}</View>
    </Pressable></Pressable>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.overlay },
  card: { width: '100%', maxWidth: 300, padding: spacing.xl, borderRadius: radii.lg },
  title: { fontFamily: fonts.serif, fontSize: 18, lineHeight: 26, fontWeight: '600', textAlign: 'center', includeFontPadding: false },
  message: { marginTop: spacing.sm, fontSize: 11, lineHeight: 18, textAlign: 'center' }, error: { marginTop: spacing.sm, color: colors.danger, fontSize: 11, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  actionsVertical: { flexDirection: 'column' },
  button: { flex: 1, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md },
  buttonVertical: { flex: 0, width: '100%' },
  buttonText: { fontSize: 12, fontWeight: '700' }, pressed: { opacity: 0.58 },
});
