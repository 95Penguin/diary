import assert from 'node:assert/strict';
import test from 'node:test';

import { clusterFootprintPlaces, groupFootprintPlaces, groupFootprintRegions, initialFootprintCamera, summarizeFootprintPlace } from '../src/utils/footprint.ts';

test('footprint groups repeated visits and keeps recent entries first', () => {
  const places = groupFootprintPlaces([
    { id: '1', content: '早上', occurredAt: '2026-07-01T01:00:00.000Z', locationName: '图书馆', latitude: 30.12341, longitude: 120.12341 },
    { id: '2', content: '下午', occurredAt: '2026-07-02T01:00:00.000Z', locationName: '图书馆', latitude: 30.12344, longitude: 120.12344 },
    { id: '3', content: '回家', occurredAt: '2026-07-03T01:00:00.000Z', locationName: '家', latitude: 30.2, longitude: 120.2 },
  ]);
  assert.equal(places.length, 2);
  const library = places.find((place) => place.name === '图书馆');
  assert.deepEqual(library?.entries.map((entry) => entry.id), ['2', '1']);
});

test('footprint clusters at low zoom and separates at street zoom', () => {
  const places = groupFootprintPlaces([
    { id: '1', content: 'A', occurredAt: '2026-07-01T01:00:00.000Z', locationName: 'A', latitude: 30.1, longitude: 120.1 },
    { id: '2', content: 'B', occurredAt: '2026-07-02T01:00:00.000Z', locationName: 'B', latitude: 30.2, longitude: 120.2 },
  ]);
  assert.equal(clusterFootprintPlaces(places, 4).length, 1);
  assert.equal(clusterFootprintPlaces(places, 14).length, 2);
  assert.ok(initialFootprintCamera(places).zoom > 3);
});

test('a single footprint opens at neighborhood-level zoom', () => {
  const places = groupFootprintPlaces([
    { id: '1', content: '看书', occurredAt: '2026-07-01T01:00:00.000Z', locationName: '图书馆', latitude: 39.96, longitude: 116.36 },
  ]);
  assert.equal(initialFootprintCamera(places).zoom, 14);
});

test('footprint regions keep nearby campus buildings together at every map zoom', () => {
  const places = groupFootprintPlaces([
    { id: '1', content: '看书', occurredAt: '2026-07-01T01:00:00.000Z', locationName: '图书馆', latitude: 39.9627, longitude: 116.3607 },
    { id: '2', content: '回宿舍', occurredAt: '2026-07-02T01:00:00.000Z', locationName: '学十公寓', latitude: 39.9642, longitude: 116.3622 },
    { id: '3', content: '旅行', occurredAt: '2026-07-03T01:00:00.000Z', locationName: '颐和园', latitude: 39.9999, longitude: 116.2755 },
  ]);
  const regions = groupFootprintRegions(places);
  assert.equal(regions.length, 2);
  assert.equal(regions.find((region) => region.places.length === 2)?.places.length, 2);
});

test('footprint place summary counts visits and distinct local dates', () => {
  const [place] = groupFootprintPlaces([
    { id: '1', content: '早上', occurredAt: '2026-07-01T01:00:00.000Z', locationName: '图书馆', latitude: 30.1, longitude: 120.1 },
    { id: '2', content: '晚上', occurredAt: '2026-07-01T12:00:00.000Z', locationName: '图书馆', latitude: 30.1, longitude: 120.1 },
    { id: '3', content: '次日', occurredAt: '2026-07-02T01:00:00.000Z', locationName: '图书馆', latitude: 30.1, longitude: 120.1 },
  ]);
  assert.deepEqual(summarizeFootprintPlace(place), {
    visits: 3,
    visitDays: 2,
    firstVisitedAt: '2026-07-01T01:00:00.000Z',
    lastVisitedAt: '2026-07-02T01:00:00.000Z',
  });
});
