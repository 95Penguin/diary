import type { SQLiteDatabase } from 'expo-sqlite';

import {
  JOURNAL_TEMPLATES,
  emptyJournalTemplateSettings,
  parseJournalTemplateSettings,
  resolveJournalTemplates,
  type JournalTemplate,
  type JournalTemplateFields,
  type JournalTemplateSettings,
} from '../utils/journal-templates.ts';

const STORAGE_KEY = 'journal-template-settings';

function createId() {
  return `template-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function getJournalTemplateSettings(db: SQLiteDatabase): Promise<JournalTemplateSettings> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv_store WHERE key = ?', STORAGE_KEY);
  if (!row) return emptyJournalTemplateSettings();
  try { return parseJournalTemplateSettings(JSON.parse(row.value)); } catch { return emptyJournalTemplateSettings(); }
}

export async function saveJournalTemplateSettings(db: SQLiteDatabase, settings: JournalTemplateSettings) {
  await db.runAsync(
    `INSERT INTO kv_store (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    STORAGE_KEY, JSON.stringify(parseJournalTemplateSettings(settings)),
  );
}

export async function listJournalTemplates(db: SQLiteDatabase) {
  return resolveJournalTemplates(await getJournalTemplateSettings(db));
}

export async function saveJournalTemplate(
  db: SQLiteDatabase,
  id: string | null,
  fields: JournalTemplateFields,
) {
  const clean = { title: fields.title.trim(), description: fields.description.trim(), content: fields.content.trim() };
  if (!clean.title || clean.title.length > 30 || clean.description.length > 80 || !clean.content || clean.content.length > 4000) throw new Error('invalid-template');
  const settings = await getJournalTemplateSettings(db);
  const system = id ? JOURNAL_TEMPLATES.find((item) => item.id === id) : null;
  if (system) settings.systemOverrides[id!] = clean;
  else if (id) {
    const index = settings.custom.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('template-not-found');
    settings.custom[index] = { id, source: 'custom', ...clean };
  } else {
    settings.custom.push({ id: createId(), source: 'custom', ...clean });
  }
  await saveJournalTemplateSettings(db, settings);
}

export async function resetSystemJournalTemplate(db: SQLiteDatabase, id: string) {
  const settings = await getJournalTemplateSettings(db);
  delete settings.systemOverrides[id];
  await saveJournalTemplateSettings(db, settings);
}

export async function deleteCustomJournalTemplate(db: SQLiteDatabase, id: string) {
  const settings = await getJournalTemplateSettings(db);
  settings.custom = settings.custom.filter((item) => item.id !== id);
  await saveJournalTemplateSettings(db, settings);
}

export function isCustomizedSystemTemplate(settings: JournalTemplateSettings, template: JournalTemplate) {
  return template.source === 'system' && Boolean(settings.systemOverrides[template.id]);
}
