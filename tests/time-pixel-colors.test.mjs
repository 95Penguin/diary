import assert from 'node:assert/strict';
import test from 'node:test';

import { createJournalExport } from '../src/database/journal-repository.ts';
import { migrateDatabase } from '../src/database/migrate.ts';
import { createTimePixelCategory, getTimePixelSnapshot, initializeTimePixels, saveTimePixelRange, updateTimePixelCategory } from '../src/database/time-pixel-repository.ts';
import { TIME_PIXEL_LEGACY_PALETTE, TIME_PIXEL_PALETTE, suggestedTimePixelColor, timePixelColor, timePixelColorChoices, timePixelTextColor } from '../src/utils/time-pixel-colors.ts';
import { createTestDatabase } from './sqlite-test-adapter.mjs';

const category = (id, kind, colorToken) => ({ id, kind, colorToken, name: id, createdAt: '', updatedAt: '' });

test('new palette has seven balanced families while preserving every v1.0.10 saved color', () => {
  assert.deepEqual(TIME_PIXEL_LEGACY_PALETTE.map(({ token, color }) => [token, color]), [
    ['fern', '#5B8C72'], ['mist', '#7E9FB8'], ['lavender', '#9A86B8'], ['amber', '#C69A4B'],
    ['rose', '#B8757C'], ['teal', '#4F9290'], ['slate', '#7C8793'], ['clay', '#A67C68'],
    ['pine', '#346B63'], ['sky', '#5F86C2'], ['indigo', '#686AA8'], ['plum', '#9B5F8B'],
    ['coral', '#C76F5B'], ['orange', '#C9823F'], ['olive', '#7E8C4B'], ['sand', '#B39A70'],
  ]);
  assert.equal(TIME_PIXEL_PALETTE.length, 28);
  assert.deepEqual([...new Set(TIME_PIXEL_PALETTE.map((item) => item.family))].sort(), ['blue', 'green', 'indigo', 'orange', 'purple', 'red', 'yellow']);
  assert.equal([...new Set(TIME_PIXEL_PALETTE.map((item) => item.family))].every((family) => TIME_PIXEL_PALETTE.filter((item) => item.family === family).length === 4), true);
  for (const item of TIME_PIXEL_PALETTE) assert.equal(timePixelColor(item.token), item.color);
  for (const item of TIME_PIXEL_LEGACY_PALETTE) assert.equal(timePixelColor(item.token), item.color);
  assert.equal(timePixelColor('unknown-backup-token'), TIME_PIXEL_PALETTE[0].color);
});

test('pixel labels choose readable text without adding a background', () => {
  const luminance = (color) => color.slice(1).match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const contrast = (first, second) => {
    const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  for (const item of [...TIME_PIXEL_PALETTE, ...TIME_PIXEL_LEGACY_PALETTE]) {
    const text = timePixelTextColor(item.token);
    assert.ok(contrast(item.color, text) >= 4.5, `${item.label}的文字对比度不足`);
  }
});

test('color usage counts same-layer peers, excluding the edited category', () => {
  const categories = [category('home', 'location', 'spring-green'), category('dorm', 'location', 'spring-green'), category('school', 'stage', 'spring-green')];
  assert.deepEqual(timePixelColorChoices(categories, 'location')[0].usedBy.map((item) => item.id), ['home', 'dorm']);
  assert.deepEqual(timePixelColorChoices(categories, 'location', 'home')[0].usedBy.map((item) => item.id), ['dorm']);
  assert.deepEqual(timePixelColorChoices(categories, 'stage', 'school')[0].usedBy, []);
  assert.equal(timePixelColorChoices(categories, 'location').length, 28);
  assert.equal(categories.length, 3);
});

test('a legacy color stays available only while editing the category that uses it', () => {
  const categories = [category('home', 'location', 'fern'), category('dorm', 'location', 'fern')];
  assert.equal(timePixelColorChoices(categories, 'location').some((item) => item.token === 'fern'), false);
  const editingChoices = timePixelColorChoices(categories, 'location', 'home');
  assert.equal(editingChoices.length, 29);
  assert.deepEqual(editingChoices.find((item) => item.token === 'fern').usedBy.map((item) => item.id), ['dorm']);
});

test('new categories suggest an unused color in their own layer and permit a full palette', () => {
  assert.equal(suggestedTimePixelColor([], 'location'), 'spring-green');
  assert.equal(suggestedTimePixelColor([category('school', 'stage', 'spring-green')], 'location'), 'spring-green');
  assert.equal(suggestedTimePixelColor([category('home', 'location', 'spring-green')], 'location'), 'mint-green');
  const occupied = TIME_PIXEL_PALETTE.map((item) => category(item.token, 'location', item.token));
  assert.equal(suggestedTimePixelColor(occupied, 'location'), 'spring-green');
  assert.equal(timePixelColorChoices(occupied, 'location').every((item) => item.usedBy.length === 1), true);
  assert.equal(suggestedTimePixelColor([category('old-import', 'location', 'unknown-token')], 'location'), 'mint-green');
});

test('recoloring updates all historical ranges by category without changing dates or notes; duplicates remain valid', async (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  await migrateDatabase(db);
  const now = new Date('2026-09-01T12:00:00+08:00');
  await initializeTimePixels(db, '2020-01-01', now);
  const home = await createTimePixelCategory(db, { kind: 'location', name: '老家', colorToken: 'fern' }, now);
  await createTimePixelCategory(db, { kind: 'location', name: '宿舍', colorToken: 'rose' }, now);
  await saveTimePixelRange(db, { categoryId: home, startDate: '2020-01-01', endDate: '2020-02-01', note: '寒假' }, now);
  await saveTimePixelRange(db, { categoryId: home, startDate: '2021-01-01', endDate: '2021-02-01', note: '回家' }, now);
  const before = await getTimePixelSnapshot(db);
  await updateTimePixelCategory(db, home, { name: '老家', colorToken: 'rose' }, new Date('2026-09-02T12:00:00+08:00'));
  const after = await getTimePixelSnapshot(db);
  assert.deepEqual(after.ranges, before.ranges);
  assert.equal(after.categories.find((item) => item.id === home).colorToken, 'rose');
  assert.equal(timePixelColorChoices(after.categories, 'location', home).find((item) => item.token === 'rose').usedBy.length, 1);
  const backup = await createJournalExport(db);
  assert.equal(backup.timePixelCategories.find((item) => item.id === home).colorToken, 'rose');
});
