import assert from 'node:assert/strict';
import test from 'node:test';

import { isReleasedDatabaseError } from '../src/database/database-recovery.ts';

test('recognizes Expo Android released shared-object failures', () => {
  assert.equal(isReleasedDatabaseError(new Error('Cannot use shared object that was already released')), true);
  assert.equal(isReleasedDatabaseError(new Error("Cannot convert provided JavaScriptObject to the SharedObject, because it doesn't contain valid data")), true);
  assert.equal(isReleasedDatabaseError(new Error('NativeDatabase.prepareAsync rejected: NativeStatement (received class java.lang.Integer)')), true);
});

test('does not reconnect for ordinary SQL or validation failures', () => {
  assert.equal(isReleasedDatabaseError(new Error('UNIQUE constraint failed: entries.id')), false);
  assert.equal(isReleasedDatabaseError(new Error('no such table: entries')), false);
  assert.equal(isReleasedDatabaseError(new Error('invalid-backup')), false);
});
