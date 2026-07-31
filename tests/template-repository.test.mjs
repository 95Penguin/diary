import assert from 'node:assert/strict';
import test from 'node:test';

import { migrateDatabase } from '../src/database/migrate.ts';
import {
  deleteCustomJournalTemplate,
  getJournalTemplateSettings,
  listJournalTemplates,
  resetSystemJournalTemplate,
  saveJournalTemplate,
} from '../src/database/template-repository.ts';
import { JOURNAL_TEMPLATES, mergeJournalTemplateSettings, parseJournalTemplateSettings } from '../src/utils/journal-templates.ts';
import { createTestDatabase } from './sqlite-test-adapter.mjs';

async function setup() {
  const db = createTestDatabase();
  await migrateDatabase(db);
  return db;
}

test('system templates can be edited and restored without changing defaults', async () => {
  const db = await setup();
  const original = JOURNAL_TEMPLATES[0];
  await saveJournalTemplate(db, original.id, { title: '我的复盘', description: '自己改过', content: '今天：' });
  let templates = await listJournalTemplates(db);
  assert.equal(templates[0].title, '我的复盘');
  assert.equal(JOURNAL_TEMPLATES[0].title, original.title);
  assert.ok((await getJournalTemplateSettings(db)).systemOverrides[original.id]);

  await resetSystemJournalTemplate(db, original.id);
  templates = await listJournalTemplates(db);
  assert.equal(templates[0].title, original.title);
  assert.equal((await getJournalTemplateSettings(db)).systemOverrides[original.id], undefined);
});

test('custom templates can be created, edited and deleted', async () => {
  const db = await setup();
  await saveJournalTemplate(db, null, { title: '周复盘', description: '一周一次', content: '本周完成：' });
  let custom = (await listJournalTemplates(db)).find((item) => item.source === 'custom');
  assert.ok(custom);
  await saveJournalTemplate(db, custom.id, { title: '每周复盘', description: '', content: '这周：' });
  custom = (await listJournalTemplates(db)).find((item) => item.id === custom.id);
  assert.equal(custom.title, '每周复盘');
  await deleteCustomJournalTemplate(db, custom.id);
  assert.equal((await listJournalTemplates(db)).some((item) => item.id === custom.id), false);
});

test('empty settings are isolated between databases', async () => {
  const first = await setup();
  const second = await setup();
  const firstSettings = await getJournalTemplateSettings(first);
  firstSettings.custom.push({ id: 'local-only', source: 'custom', title: '本机', description: '', content: '内容：' });
  assert.deepEqual((await getJournalTemplateSettings(second)).custom, []);
});

test('merge restore preserves local conflicts and adds backup-only templates', () => {
  const local = parseJournalTemplateSettings({
    systemOverrides: { mood: { title: '本机情绪', description: '', content: '本机：' } },
    custom: [{ id: 'same', source: 'custom', title: '本机模板', description: '', content: '本机：' }],
  });
  const backup = parseJournalTemplateSettings({
    systemOverrides: { mood: { title: '备份情绪', description: '', content: '备份：' } },
    custom: [
      { id: 'same', source: 'custom', title: '备份模板', description: '', content: '备份：' },
      { id: 'backup-only', source: 'custom', title: '备份独有', description: '', content: '独有：' },
    ],
  });
  const merged = mergeJournalTemplateSettings(local, backup);
  assert.equal(merged.systemOverrides.mood.title, '本机情绪');
  assert.deepEqual(merged.custom.map((item) => item.title), ['本机模板', '备份独有']);
});

test('parser drops duplicate and system-colliding custom template ids', () => {
  const parsed = parseJournalTemplateSettings({
    systemOverrides: {},
    custom: [
      { id: 'daily-review', source: 'custom', title: '冲突', description: '', content: '内容：' },
      { id: 'same', source: 'custom', title: '保留', description: '', content: '内容：' },
      { id: 'same', source: 'custom', title: '重复', description: '', content: '内容：' },
    ],
  });
  assert.deepEqual(parsed.custom.map((item) => item.title), ['保留']);
});
