import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppDialog } from '@/components/app-dialog';
import {
  deleteCustomJournalTemplate,
  getJournalTemplateSettings,
  isCustomizedSystemTemplate,
  listJournalTemplates,
  resetSystemJournalTemplate,
  saveJournalTemplate,
} from '@/database/template-repository';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { emptyJournalTemplateSettings, type JournalTemplate, type JournalTemplateSettings } from '@/utils/journal-templates';

type EditorState = { template: JournalTemplate | null; title: string; description: string; content: string };

export default function TemplatesScreen() {
  const db = useSQLiteContext();
  const { readingTheme } = useAppPreferences();
  const [templates, setTemplates] = useState<JournalTemplate[]>([]);
  const [settings, setSettings] = useState<JournalTemplateSettings>(() => emptyJournalTemplateSettings());
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<JournalTemplate | null>(null);
  const [pendingReset, setPendingReset] = useState<JournalTemplate | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [nextTemplates, nextSettings] = await Promise.all([listJournalTemplates(db), getJournalTemplateSettings(db)]);
    setTemplates(nextTemplates);
    setSettings(nextSettings);
  }, [db]);
  useFocusEffect(useCallback(() => {
    void load().catch(() => setNotice('模板读取失败，请稍后重试'));
  }, [load]));

  function beginEdit(template: JournalTemplate | null) {
    setError('');
    setEditor({ template, title: template?.title ?? '', description: template?.description ?? '', content: template?.content ?? '' });
  }

  async function save() {
    if (!editor || saving) return;
    if (!editor.title.trim() || !editor.content.trim()) { setError('请填写模板名称和正文'); return; }
    setSaving(true);
    try {
      await saveJournalTemplate(db, editor.template?.id ?? null, editor);
      setEditor(null);
      setNotice('模板已保存');
      await load();
    } catch {
      setError('保存失败，请稍后重试');
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!pendingDelete) return;
    try {
      await deleteCustomJournalTemplate(db, pendingDelete.id);
      setPendingDelete(null);
      setNotice('模板已删除');
      await load();
    } catch { setPendingDelete(null); setNotice('删除失败，请稍后重试'); }
  }

  async function reset() {
    if (!pendingReset) return;
    try {
      await resetSystemJournalTemplate(db, pendingReset.id);
      setPendingReset(null);
      setNotice('已恢复系统默认');
      await load();
    } catch { setPendingReset(null); setNotice('恢复失败，请稍后重试'); }
  }

  const systemTemplates = templates.filter((item) => item.source === 'system');
  const customTemplates = templates.filter((item) => item.source === 'custom');

  return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}><Pressable accessibilityLabel="返回" hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable><Text style={[styles.headerTitle, { color: readingTheme.text }]}>模板管理</Text><Pressable accessibilityLabel="新建模板" hitSlop={10} onPress={() => beginEdit(null)}><Text style={styles.add}>＋ 新建</Text></Pressable></View>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={[styles.hint, { color: readingTheme.secondary }]}>系统模板可以修改，并随时恢复默认；你创建的模板可以自由编辑或删除。所有模板都会包含在完整备份中。</Text>
      {notice ? <Text style={[styles.notice, { color: notice.includes('失败') ? colors.danger : colors.primary }]}>{notice}</Text> : null}
      <TemplateSection title="系统模板" templates={systemTemplates} customized={(item) => isCustomizedSystemTemplate(settings, item)} onEdit={beginEdit} onDelete={setPendingDelete} onReset={setPendingReset} text={readingTheme.text} secondary={readingTheme.secondary} surface={readingTheme.surface} />
      <TemplateSection title="我的模板" templates={customTemplates} customized={() => false} onEdit={beginEdit} onDelete={setPendingDelete} onReset={setPendingReset} text={readingTheme.text} secondary={readingTheme.secondary} surface={readingTheme.surface} />
      {!customTemplates.length ? <Pressable onPress={() => beginEdit(null)} style={[styles.empty, { borderColor: readingTheme.border }]}><Text style={[styles.emptyText, { color: readingTheme.secondary }]}>还没有自建模板，点这里创建一个</Text></Pressable> : null}
    </ScrollView>
    <Modal visible={Boolean(editor)} transparent animationType="fade" onRequestClose={() => setEditor(null)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
        <View style={[styles.editor, { backgroundColor: readingTheme.background }]}>
          <Text style={[styles.editorTitle, { color: readingTheme.text }]}>{editor?.template ? '编辑模板' : '新建模板'}</Text>
          <TextInput maxLength={30} value={editor?.title ?? ''} onChangeText={(title) => setEditor((value) => value ? { ...value, title } : value)} placeholder="模板名称" placeholderTextColor={readingTheme.secondary} style={[styles.input, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} />
          <TextInput maxLength={80} value={editor?.description ?? ''} onChangeText={(description) => setEditor((value) => value ? { ...value, description } : value)} placeholder="一句简介（可选）" placeholderTextColor={readingTheme.secondary} style={[styles.input, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} />
          <TextInput multiline maxLength={4000} textAlignVertical="top" value={editor?.content ?? ''} onChangeText={(content) => setEditor((value) => value ? { ...value, content } : value)} placeholder="写下套用模板时插入的正文" placeholderTextColor={readingTheme.secondary} style={[styles.input, styles.contentInput, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.editorActions}><Pressable disabled={saving} onPress={() => setEditor(null)} style={[styles.action, { backgroundColor: readingTheme.surface }, saving && styles.disabled]}><Text style={{ color: readingTheme.text }}>取消</Text></Pressable><Pressable disabled={saving} onPress={() => void save()} style={[styles.action, { backgroundColor: colors.primary }, saving && styles.disabled]}><Text style={styles.saveText}>{saving ? '保存中…' : '保存'}</Text></Pressable></View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
    <AppDialog visible={Boolean(pendingDelete)} title="删除这个模板？" message="删除后不会影响已经使用过模板的记录。" onClose={() => setPendingDelete(null)} actions={[{ label: '取消', onPress: () => setPendingDelete(null) }, { label: '删除', tone: 'danger', onPress: remove }]} />
    <AppDialog visible={Boolean(pendingReset)} title="恢复系统默认？" message="你对这个系统模板的修改会被清除。" onClose={() => setPendingReset(null)} actions={[{ label: '取消', onPress: () => setPendingReset(null) }, { label: '恢复默认', tone: 'primary', onPress: reset }]} />
  </SafeAreaView>;
}

function TemplateSection({ title, templates, customized, onEdit, onDelete, onReset, text, secondary, surface }: { title: string; templates: JournalTemplate[]; customized: (item: JournalTemplate) => boolean; onEdit: (item: JournalTemplate) => void; onDelete: (item: JournalTemplate) => void; onReset: (item: JournalTemplate) => void; text: string; secondary: string; surface: string }) {
  return <View style={styles.section}><Text style={[styles.sectionTitle, { color: secondary }]}>{title}</Text>{templates.map((item) => <View key={item.id} style={[styles.item, { backgroundColor: surface }]}><Pressable onPress={() => onEdit(item)} style={styles.itemCopy}><View style={styles.itemHeading}><Text style={[styles.itemTitle, { color: text }]}>{item.title}</Text>{customized(item) ? <Text style={styles.badge}>已修改</Text> : null}</View><Text numberOfLines={2} style={[styles.description, { color: secondary }]}>{item.description || item.content}</Text></Pressable><View style={styles.itemActions}>{customized(item) ? <Pressable hitSlop={8} onPress={() => onReset(item)}><Text style={styles.reset}>恢复</Text></Pressable> : null}{item.source === 'custom' ? <Pressable hitSlop={8} onPress={() => onDelete(item)}><Text style={styles.delete}>删除</Text></Pressable> : null}<Pressable hitSlop={8} onPress={() => onEdit(item)}><Text style={styles.edit}>编辑</Text></Pressable></View></View>)}</View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, header: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth }, back: { color: colors.primary, fontSize: 13 }, headerTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' }, add: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  content: { padding: spacing.xl, paddingBottom: spacing.xxxl }, hint: { fontSize: 11, lineHeight: 18 }, notice: { marginTop: spacing.sm, fontSize: 11 }, section: { gap: spacing.sm, marginTop: spacing.xl }, sectionTitle: { fontSize: 11, fontWeight: '700' }, item: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radii.md }, itemCopy: { flex: 1 }, itemHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, itemTitle: { fontSize: 13, fontWeight: '700' }, badge: { color: colors.primary, fontSize: 9, fontWeight: '700' }, description: { marginTop: 4, fontSize: 10, lineHeight: 15 }, itemActions: { alignItems: 'flex-end', gap: 5 }, edit: { color: colors.primary, fontSize: 11 }, reset: { color: colors.primary, fontSize: 10 }, delete: { color: colors.danger, fontSize: 10 }, empty: { marginTop: spacing.md, padding: spacing.xl, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderStyle: 'dashed', borderRadius: radii.md }, emptyText: { fontSize: 11 }, disabled: { opacity: 0.5 },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.overlay }, editor: { width: '100%', maxWidth: 380, padding: spacing.xl, borderRadius: radii.lg }, editorTitle: { marginBottom: spacing.lg, fontFamily: fonts.serif, fontSize: 18, fontWeight: '600', textAlign: 'center' }, input: { minHeight: 44, marginBottom: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.md, fontSize: 13 }, contentInput: { minHeight: 190, lineHeight: 20 }, error: { marginBottom: spacing.sm, color: colors.danger, fontSize: 11 }, editorActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }, action: { flex: 1, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md }, saveText: { color: '#FFFFFF', fontWeight: '700' },
});
