import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { useAppPreferences } from '@/preferences/app-preferences';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { ButtonLabel, DangerButton, PrimaryButton, SecondaryButton } from '@/components/ui/buttons';

export function EntryActionModal({ visible, onClose, onEdit, onDelete, onHistory, onShare }: { visible: boolean; onClose: () => void; onEdit: () => void; onDelete: () => void | Promise<void>; onHistory?: () => void; onShare?: () => void }) {
  const { readingTheme } = useAppPreferences();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  function close() { setConfirmingDelete(false); onClose(); }
  function edit() { setConfirmingDelete(false); onEdit(); }
  function history() { setConfirmingDelete(false); onHistory?.(); }
  function share() { setConfirmingDelete(false); onShare?.(); }
  async function remove() { await onDelete(); setConfirmingDelete(false); }

  const actionCount = Number(Boolean(onHistory)) + Number(Boolean(onShare));
  return <BottomSheet visible={visible} onClose={close} backgroundColor={readingTheme.background} contentHeight={confirmingDelete ? 210 : 220 + actionCount * 52}>
      <ScrollView bounces={false} style={styles.scroll} contentContainerStyle={styles.card} showsVerticalScrollIndicator={false}>
        <Text style={[styles.title, { color: readingTheme.text }]}>{confirmingDelete ? '将这条记录移入回收站？' : '记录操作'}</Text>
        {confirmingDelete ? <Text style={[styles.message, { color: readingTheme.secondary }]}>记录会移入回收站，并保留 30 天</Text> : null}
        {!confirmingDelete && onHistory ? <Pressable onPress={history} style={({ pressed }) => [styles.historyButton, { backgroundColor: readingTheme.surface }, pressed && styles.pressed]}><Text style={[styles.historyText, { color: readingTheme.secondary }]}>编辑历史</Text><Text style={styles.historyArrow}>›</Text></Pressable> : null}
        {!confirmingDelete && onShare ? <Pressable onPress={share} style={({ pressed }) => [styles.historyButton, styles.secondaryAction, { backgroundColor: readingTheme.surface }, pressed && styles.pressed]}><Text style={[styles.historyText, { color: readingTheme.secondary }]}>生成分享卡片</Text><Text style={styles.historyArrow}>›</Text></Pressable> : null}
        <View style={styles.buttons}>
          {confirmingDelete ? <>
            <SecondaryButton onPress={() => setConfirmingDelete(false)} style={styles.button}><ButtonLabel tone="secondary">取消</ButtonLabel></SecondaryButton>
            <DangerButton onPress={() => void remove()} style={styles.button}><ButtonLabel tone="danger">移入回收站</ButtonLabel></DangerButton>
          </> : <>
            <PrimaryButton onPress={edit} style={styles.button}><ButtonLabel>编辑</ButtonLabel></PrimaryButton>
            <DangerButton onPress={() => setConfirmingDelete(true)} style={styles.button}><ButtonLabel tone="danger">移入回收站</ButtonLabel></DangerButton>
          </>}
        </View>
        {!confirmingDelete ? <Pressable onPress={close} style={styles.cancel}><Text style={[styles.cancelText, { color: readingTheme.secondary }]}>取消</Text></Pressable> : null}
      </ScrollView>
  </BottomSheet>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1 }, card: { paddingHorizontal: spacing.xl, paddingTop: spacing.xxl },
  title: { color: colors.text, fontFamily: fonts.serif, fontSize: 18, lineHeight: 26, fontWeight: '600', textAlign: 'center', includeFontPadding: false },
  message: { marginTop: spacing.sm, color: colors.textFaint, fontSize: 11, textAlign: 'center' },
  historyButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radii.md, backgroundColor: colors.surfaceMuted }, historyText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' }, historyArrow: { color: colors.primary, fontSize: 20 },
  secondaryAction: { marginTop: spacing.sm },
  buttons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl }, button: { flex: 1, minHeight: 46, paddingHorizontal: spacing.xs }, pressed: { opacity: 0.58 },
  cancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm }, cancelText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
});
