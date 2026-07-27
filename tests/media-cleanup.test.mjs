import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldDeleteUnusedMedia } from '../src/utils/media-cleanup-policy.ts';

const now = Date.parse('2026-07-27T12:00:00.000Z');
const grace = 6 * 60 * 60 * 1000;

test('never removes referenced media', () => {
  assert.equal(
    shouldDeleteUnusedMedia(
      { uri: 'file:///kept.jpg', modificationTime: now - grace * 2 },
      new Set(['file:///kept.jpg']),
      now,
      grace,
    ),
    false,
  );
});

test('keeps recent unreferenced files and removes expired leftovers', () => {
  const references = new Set();
  assert.equal(
    shouldDeleteUnusedMedia(
      { uri: 'file:///recent.jpg', modificationTime: now - grace + 1 },
      references,
      now,
      grace,
    ),
    false,
  );
  assert.equal(
    shouldDeleteUnusedMedia(
      { uri: 'file:///expired.jpg', modificationTime: now - grace },
      references,
      now,
      grace,
    ),
    true,
  );
});

test('keeps files with unknown modification time', () => {
  assert.equal(
    shouldDeleteUnusedMedia(
      { uri: 'file:///unknown.jpg', modificationTime: null },
      new Set(),
      now,
      grace,
    ),
    false,
  );
});
