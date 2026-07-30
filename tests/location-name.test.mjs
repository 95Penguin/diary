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
  }), '北京市 · 海淀区 · 北京邮电大学海淀校区小白楼');
});

test('falls back to the formatted address when structured fields are unavailable', () => {
  assert.equal(formatLocationName({ formattedAddress: '北京市海淀区' }), '北京市海淀区');
});
