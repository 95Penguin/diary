import assert from 'node:assert/strict';
import test from 'node:test';

import { findLocationDuplicates } from '../src/utils/location-duplicates.ts';

test('detects nearby and similarly named locations without suggesting distant unrelated places', () => {
  const suggestions = findLocationDuplicates([
    { name: '北邮', count: 2, latitude: 39.962, longitude: 116.358 },
    { name: '北京邮电大学', count: 4, latitude: 39.9624, longitude: 116.3583 },
    { name: '学校东门', count: 1, latitude: 39.966, longitude: 116.359 },
    { name: '上海外滩', count: 1, latitude: 31.24, longitude: 121.49 },
  ]);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].first.name, '北邮');
  assert.equal(suggestions[0].second.name, '北京邮电大学');
  assert.equal(suggestions[0].reason, '距离很近');
  assert.ok(suggestions[0].distanceMeters < 120);
});

test('uses name similarity only within a conservative two-kilometer range', () => {
  const suggestions = findLocationDuplicates([
    { name: '北京邮电大学', count: 2, latitude: 39.962, longitude: 116.358 },
    { name: '北京邮电大学海淀校区', count: 1, latitude: 39.972, longitude: 116.358 },
    { name: '北京邮电大学沙河校区', count: 1, latitude: 40.16, longitude: 116.28 },
  ]);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].reason, '名称相似');
  assert.equal(suggestions[0].second.name, '北京邮电大学海淀校区');
});
