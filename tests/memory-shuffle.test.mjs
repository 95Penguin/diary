import assert from 'node:assert/strict';
import test from 'node:test';

import { pickRandomMemoryId } from '../src/utils/memory-shuffle.ts';

test('pickRandomMemoryId independently picks from all candidates', () => {
  assert.equal(pickRandomMemoryId(['a', 'b', 'c', 'd'], null, () => 0.6), 'c');
});

test('pickRandomMemoryId avoids only an immediate repeat', () => {
  assert.equal(pickRandomMemoryId(['a', 'b', 'c'], 'b', () => 0.99), 'c');
  assert.equal(pickRandomMemoryId(['a'], 'a', () => 0.5), 'a');
});
