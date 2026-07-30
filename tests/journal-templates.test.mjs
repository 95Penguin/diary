import assert from 'node:assert/strict';
import test from 'node:test';

import { applyJournalTemplate, JOURNAL_TEMPLATES } from '../src/utils/journal-templates.ts';

test('journal templates have unique ids and useful local content', () => {
  assert.equal(new Set(JOURNAL_TEMPLATES.map((item) => item.id)).size, JOURNAL_TEMPLATES.length);
  assert.ok(JOURNAL_TEMPLATES.length >= 4 && JOURNAL_TEMPLATES.length <= 6);
  JOURNAL_TEMPLATES.forEach((item) => {
    assert.ok(item.title.trim());
    assert.ok(item.description.trim());
    assert.ok(item.content.includes('：'));
  });
});

test('applying a template never overwrites existing journal text', () => {
  const template = JOURNAL_TEMPLATES[0];
  assert.equal(applyJournalTemplate('', template), template.content);
  assert.equal(applyJournalTemplate('已有内容', template), `已有内容\n\n${template.content}`);
  assert.equal(applyJournalTemplate('已有内容\n\n', template), `已有内容\n\n${template.content}`);
});
