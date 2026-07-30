import test from 'node:test';
import assert from 'node:assert/strict';

import { gcj02ToWgs84, wgs84ToGcj02 } from '../src/utils/china-coordinates.ts';

test('mainland coordinates round trip without moving stored GPS data materially', () => {
  const wgs84 = { latitude: 39.9623, longitude: 116.3588 };
  const gcj02 = wgs84ToGcj02(wgs84);
  assert.ok(Math.abs(gcj02.latitude - wgs84.latitude) > 0.001);
  assert.ok(Math.abs(gcj02.longitude - wgs84.longitude) > 0.001);
  const restored = gcj02ToWgs84(gcj02);
  assert.ok(Math.abs(restored.latitude - wgs84.latitude) < 0.000001);
  assert.ok(Math.abs(restored.longitude - wgs84.longitude) < 0.000001);
});

test('coordinates outside mainland remain unchanged', () => {
  const paris = { latitude: 48.8566, longitude: 2.3522 };
  assert.deepEqual(wgs84ToGcj02(paris), paris);
  assert.deepEqual(gcj02ToWgs84(paris), paris);
});
