import assert from 'node:assert/strict';
import test from 'node:test';

import { formatLocationName } from '../src/utils/location-name.ts';

test('prefers concise structured address fields over a duplicated Android formatted address', () => {
  assert.equal(formatLocationName({
    region: '北京市',
    city: '北京市',
    district: '海淀区',
    name: '大学小白楼',
    street: '北京邮电大学海淀校区小白楼',
    formattedAddress: '北京市海淀区北京邮电大学小白楼北京邮电大学海淀校区小白楼',
  }), '北京 · 大学小白楼');
});

test('uses a compact city and district label when no specific place is available', () => {
  assert.equal(formatLocationName({
    region: '云南省',
    city: '大理市',
    district: '大理古城',
  }), '大理古城');
});

test('uses country and place for an overseas location', () => {
  assert.equal(formatLocationName({
    country: '法国',
    isoCountryCode: 'FR',
    city: '巴黎',
    name: '卢浮宫',
    formattedAddress: 'Rue de Rivoli, 75001 Paris, France',
  }), '法国 · 卢浮宫');
});

test('falls back to the formatted address when structured fields are unavailable', () => {
  assert.equal(formatLocationName({ formattedAddress: '北京市海淀区' }), '北京市海淀区');
});
