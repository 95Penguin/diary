import assert from 'node:assert/strict';
import test from 'node:test';

import { rankNearbyPois } from '../src/utils/location-poi.ts';

test('nearby POIs prefer a specific building over a broad campus name', () => {
  const ranked = rankNearbyPois([
    { name: '北京邮电大学海淀校区', typeDes: '科教文化服务;学校;高等院校', distance: 8 },
    { name: '北京邮电大学图书馆', typeDes: '科教文化服务;图书馆', distance: 42 },
    { name: '学十公寓', typeDes: '商务住宅;住宅区;宿舍', distance: 55 },
  ]);
  assert.equal(ranked[0].name, '北京邮电大学图书馆');
});

test('an explicit search keeps the matching POI ahead of nearby alternatives', () => {
  const ranked = rankNearbyPois([
    { name: '学校图书馆', typeDes: '科教文化服务;图书馆', distance: 10 },
    { name: '麦田咖啡', typeDes: '餐饮服务;咖啡厅', distance: 80 },
  ], '麦田咖啡');
  assert.equal(ranked[0].name, '麦田咖啡');
});
