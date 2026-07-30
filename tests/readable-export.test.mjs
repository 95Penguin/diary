import assert from 'node:assert/strict';
import test from 'node:test';
import { formatReadableJournal } from '../src/utils/readable-journal-export.ts';

const entry = {
  id: '1', content: '<今天> 写下 **日记**', occurredAt: '2026-07-30T08:00:00.000Z',
  createdAt: '2026-07-30T08:00:00.000Z', updatedAt: '2026-07-30T08:00:00.000Z',
  mood: '平静', weather: '晴', favoritedAt: null, locationName: '学校',
  latitude: 39.9, longitude: 116.3, tags: ['生活'], images: [], followUps: [{
    id: 'f1', entryId: '1', content: '后来下雨了', createdAt: '2026-07-30T09:00:00.000Z',
    updatedAt: '2026-07-30T09:00:00.000Z', images: [],
  }],
};

test('readable markdown includes journal metadata and can hide locations', () => {
  const visible = formatReadableJournal([entry], 'markdown', { includeLocations: true, title: '我的日记' });
  assert.match(visible, /# 我的日记/);
  assert.match(visible, /地点：学校/);
  assert.match(visible, /后来下雨了/);
  const hidden = formatReadableJournal([entry], 'markdown', { includeLocations: false });
  assert.doesNotMatch(hidden, /学校/);
});

test('readable html escapes user content', () => {
  const html = formatReadableJournal([entry], 'html', { includeLocations: true });
  assert.match(html, /&lt;今天&gt;/);
  assert.doesNotMatch(html, /<今天>/);
  assert.match(html, /<!doctype html>/);
});
