import assert from 'node:assert/strict';
import test from 'node:test';

import { SHARE_CARD_CONTENT_LIMIT, shareCardImageUri, shareCardPages, shareCardText } from '../src/utils/share-card.ts';

test('share card truncates only its displayed copy', () => {
  const source = '记'.repeat(SHARE_CARD_CONTENT_LIMIT + 20);
  const displayed = shareCardText(source);
  assert.equal(displayed, `${'记'.repeat(SHARE_CARD_CONTENT_LIMIT)}……`);
  assert.equal(source.length, SHARE_CARD_CONTENT_LIMIT + 20);
});

test('share card uses an image or a video thumbnail but never a raw video', () => {
  assert.equal(shareCardImageUri({ images: [{ mediaType: 'video', uri: 'clip.mp4', thumbnailUri: null }] }), null);
  assert.equal(shareCardImageUri({ images: [{ mediaType: 'video', uri: 'clip.mp4', thumbnailUri: 'poster.jpg' }] }), 'poster.jpg');
  assert.equal(shareCardImageUri({ images: [{ mediaType: 'image', uri: 'photo.jpg', thumbnailUri: null }] }), 'photo.jpg');
});

test('full share cards split long text without losing content', () => {
  const content = `${'第一段内容。'.repeat(100)}\n${'第二段内容。'.repeat(100)}`;
  const pages = shareCardPages(content, 200);
  assert.ok(pages.length > 1);
  assert.equal(pages.join('').replaceAll('\n', ''), content.replaceAll('\n', ''));
});

test('full share cards count line breaks as visual space', () => {
  const pages = shareCardPages(Array.from({ length: 30 }, (_, index) => `第${index}行`).join('\n'), 120);
  assert.ok(pages.length > 1);
  assert.match(pages[0], /第0行/);
});
