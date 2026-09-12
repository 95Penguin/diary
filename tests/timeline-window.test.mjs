import assert from 'node:assert/strict';
import test from 'node:test';

import { appendOlderWindow, prependNewerWindow } from '../src/utils/timeline-window.ts';

const items = (...ids) => ids.map((id) => ({ id }));

test('older timeline pages discard the newest edge after the memory limit', () => {
  const result = appendOlderWindow(items('6', '5', '4', '3'), items('3', '2', '1'), 5);
  assert.deepEqual(result.entries.map((item) => item.id), ['5', '4', '3', '2', '1']);
  assert.equal(result.trimmedNewest, 1);
});

test('newer timeline pages discard the oldest edge after the memory limit', () => {
  const result = prependNewerWindow(items('5', '4', '3', '2', '1'), items('7', '6', '5'), 5);
  assert.deepEqual(result.entries.map((item) => item.id), ['7', '6', '5', '4', '3']);
  assert.equal(result.trimmedOldest, 2);
});
