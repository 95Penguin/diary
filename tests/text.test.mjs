import assert from 'node:assert/strict';
import test from 'node:test';

import { countJournalCharacters } from '../src/utils/text.ts';

test('countJournalCharacters ignores whitespace and counts emoji once', () => {
  assert.equal(countJournalCharacters('今天 下雨\n🙂'), 5);
});
