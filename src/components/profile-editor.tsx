import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { launchImageLibraryAsync } from 'expo-image-picker';

import { showAppDialog } from '@/components/app-dialog-host';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { deleteJournalImage, persistJournalImage } from '@/utils/image-storage';

export type ProfileField = 'avatar' | 'nickname' | 'signature';

export function useProfileEditor({ embedded = false }: { embedded?: boolean } = {}) {
  const { preferences, readingTheme, updatePreferences } = useAppPreferences();
  const [field, setField] = useState<'nickname' | 'signature' | null>(null);
  const [nickname, setNickname] = useState('');
  const [signature, setSignature] = useState('');

  async function chooseAvatar() {
    try {
      const result = await launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      if (result.canceled) return;
      const previous = preferences.avatarUri;
      const asset = result.assets[0];
      const uri = await persistJournalImage(asset.uri, asset.fileName);
      await updatePreferences({ avatarUri: uri });
      if (previous) deleteJournalImage(previous);
    } catch {
      await showAppDialog({ title: '头像保存失败', message: '请稍后再试。' });
    }
  }

  function edit(fieldToEdit: ProfileField) {
    if (fieldToEdit === 'avatar') { void chooseAvatar(); return; }
    setNickname(preferences.nickname);
    setSignature(preferences.signature);
    setField(fieldToEdit);
  }

  async function save() {
    try {
      if (field === 'nickname') {
        const value = nickname.trim().slice(0, 20);
        if (!value) return;
        await updatePreferences({ nickname: value });
      } else if (field === 'signature') {
        await updatePreferences({ signature: signature.trim().slice(0, 50) });
      }
      setField(null);
    } catch {
      await showAppDialog({ title: '资料没有保存', message: '请稍后重试。' });
    }
  }

  const content = <Pressable onPress={() => setField(null)} style={styles.overlay}>
      <Pressable onPress={(event) => event.stopPropagation()} style={[styles.editorCard, { backgroundColor: readingTheme.background }]}>
        <Text style={[styles.editorTitle, { color: readingTheme.text }]}>{field === 'nickname' ? '编辑昵称' : '编辑个性签名'}</Text>
        {field === 'nickname'
          ? <TextInput autoFocus maxLength={20} value={nickname} onChangeText={setNickname} placeholder="输入昵称" placeholderTextColor={readingTheme.secondary} style={[styles.nicknameInput, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} />
          : <TextInput autoFocus multiline textAlignVertical="top" maxLength={50} value={signature} onChangeText={setSignature} placeholder="写一句属于你的话" placeholderTextColor={readingTheme.secondary} style={[styles.nicknameInput, styles.signatureInput, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} />}
        <View style={styles.editorActions}>
          <Pressable onPress={() => setField(null)}><Text style={[styles.cancelText, { color: readingTheme.secondary }]}>取消</Text></Pressable>
          <Pressable onPress={() => void save()}><Text style={styles.confirmText}>保存</Text></Pressable>
        </View>
      </Pressable>
    </Pressable>;

  const modal = embedded
    ? field !== null ? <View style={styles.embeddedOverlay}>{content}</View> : null
    : <Modal visible={field !== null} transparent animationType="fade" onRequestClose={() => setField(null)}>{content}</Modal>;

  return { editProfile: edit, closeProfileEditor: () => setField(null), profileEditorOpen: field !== null, profileEditorModal: modal };
}

const styles = StyleSheet.create({
  embeddedOverlay: { ...StyleSheet.absoluteFill, zIndex: 20, elevation: 20 },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.overlay },
  editorCard: { width: '100%', maxWidth: 300, padding: spacing.xl, borderRadius: radii.lg, backgroundColor: colors.background },
  editorTitle: { marginBottom: spacing.md, color: colors.text, fontFamily: fonts.serif, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  nicknameInput: { height: 44, paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted, color: colors.text, fontSize: 14 },
  signatureInput: { height: 76, paddingTop: spacing.sm },
  editorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xxl, marginTop: spacing.xl },
  cancelText: { color: colors.textSecondary, fontSize: 12 },
  confirmText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
});
