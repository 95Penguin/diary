import assert from 'node:assert/strict';
import test from 'node:test';
import { applyLocationPrivacy } from '../src/utils/location-privacy.ts';

test('location privacy preserves, approximates or removes coordinates consistently', () => {
  assert.deepEqual(applyLocationPrivacy(39.96234, 116.35876, 'precise'), {
    latitude: 39.96234, longitude: 116.35876,
  });
  assert.deepEqual(applyLocationPrivacy(39.96234, 116.35876, 'approximate'), {
    latitude: 39.96, longitude: 116.36,
  });
  assert.deepEqual(applyLocationPrivacy(39.96234, 116.35876, 'nameOnly'), {
    latitude: null, longitude: null,
  });
});

test('ask mode applies the explicit per-operation choice and handles missing coordinates', () => {
  assert.deepEqual(applyLocationPrivacy(39.96234, 116.35876, 'ask', 'approximate'), {
    latitude: 39.96, longitude: 116.36,
  });
  assert.deepEqual(applyLocationPrivacy(null, 116.35, 'precise'), {
    latitude: null, longitude: null,
  });
});
