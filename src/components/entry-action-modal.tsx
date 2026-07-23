import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { useAppPreferences } from '@/preferences/app-preferences';

export function EntryActionModal({ visible, onClose, onEdit, onDelete, onHistory }: { visible: boolean; onClose: () => void; onEdit: () => void; onDelete: () => void | Promise<void>; onHistory?: () => void }) {
  const { readingTheme } = useAppPreferences();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  function close() { setConfirmingDelete(false); onClose(); }
  function edit() { setConfirmingDelete(false); onEdit(); }
  function history() { setConfirmingDelete(false); onHistory?.(); }
  async function remove() { await onDelete(); setConfirmingDelete(false); }

  return <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
    <Pressable accessibilityRole="button" accessibilityLabel="关闭记录操作" onPress={close} style={styles.overlay}>
      <Pressable accessibilityRole="none" onPress={(event) => event.stopPropagation()} style={[styles.card, { backgroundColor: readingTheme.background }]}>
        <Text style={[styles.title, { color: readingTheme.text }]}>{confirmingDelete ? '删除这条记录？' : '记录操作'}</Text>
        {confirmingDelete ? <Text style={[styles.message, { color: readingTheme.secondary }]}>记录会移入回收站，并保留 30 天</Text> : null}
        {!confirmingDelete && onHistory ? <Pressable onPress={history} style={({ pressed }) => [styles.historyButton, { backgroundColor: readingTheme.surface }, pressed && styles.pressed]}><Text style={[styles.historyText, { color: readingTheme.secondary }]}>编辑历史</Text><Text style={styles.historyArrow}>›</Text></Pressable> : null}
        <View style={styles.buttons}>
          {confirmingDelete ? <>
            <Pressable onPress={() => setConfirmingDelete(false)} style={({ pressed }) => [styles.button, { backgroundColor: readingTheme.surface }, pressed && styles.pressed]}><Text style={[styles.cancelText, { color: readingTheme.secondary }]}>取消</Text></Pressable>
            <Pressable onPress={() => void remove()} style={({ pressed }) => [styles.button, { backgroundColor: readingTheme.surface }, pressed && styles.pressed]}><Text style={styles.dangerText}>删除</Text></Pressable>
          </> : <>
            <Pressable onPress={edit} style={({ pressed }) => [styles.button, { backgroundColor: readingTheme.surface }, pressed && styles.pressed]}><Text style={styles.primaryText}>编辑</Text></Pressable>
            <Pressable onPress={() => setConfirmingDelete(true)} style={({ pressed }) => [styles.button, { backgroundColor: readingTheme.surface }, pressed && styles.pressed]}><Text style={styles.dangerText}>删除</Text></Pressable>
          </>}
        </View>
        {!confirmingDelete ? <Pressable onPress={close} style={styles.cancel}><Text style={[styles.cancelText, { color: readingTheme.secondary }]}>取消</Text></Pressable> : null}
      </Pressable>
    </Pressable>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.overlay },
  card: { width: '100%', maxWidth: 300, padding: spacing.xl, borderRadius: radii.lg, backgroundColor: colors.background },
  title: { color: colors.text, fontFamily: fonts.serif, fontSize: 18, lineHeight: 26, fontWeight: '600', textAlign: 'center', includeFontPadding: false },
  message: { marginTop: spacing.sm, color: colors.textFaint, fontSize: 11, textAlign: 'center' },
  historyButton: { height: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg, paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted }, historyText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' }, historyArrow: { color: colors.primary, fontSize: 20 },
  buttons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl }, button: { flex: 1, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.surfaceMuted }, pressed: { opacity: 0.58 },
  primaryText: { color: colors.primary, fontSize: 13, fontWeight: '700' }, dangerText: { color: colors.danger, fontSize: 13, fontWeight: '700' }, cancel: { alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg }, cancelText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
});
