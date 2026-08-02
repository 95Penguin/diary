import assert from 'node:assert/strict';
import test from 'node:test';

import { searchSnippet } from '../src/utils/search-snippet.ts';

test('search snippet brings a distant match into view', () => {
  const text = `${'开头'.repeat(40)}这里有关键词以及后面的内容`;
  const snippet = searchSnippet(text, '关键词', 8, 8);
  assert.match(snippet, /关键词/);
  assert.ok(snippet.startsWith('…'));
  assert.ok(snippet.length < text.length);
});

test('search snippet keeps untouched text when query is absent', () => {
  assert.equal(searchSnippet('一段正文', '没有'), '一段正文');
});
