import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMediaLibraryRows, filterLibraryMedia, isVideoMedia } from '../src/utils/media-library.ts';

function item(id, occurredAt, mediaType = 'image') {
  return { id, occurredAt, mediaType, duration: null, uri: `file:///${id}`, entryId: 'entry', source: 'entry', sourceId: 'entry', width: 1, height: 1, sortOrder: 0, pairedVideoUri: null, thumbnailUri: null, attachedAt: occurredAt, entryContent: '' };
}

test('media library creates month headers and rows of three', () => {
  const rows = buildMediaLibraryRows([
    item('a', '2026-07-31T12:00:00.000Z'), item('b', '2026-07-30T12:00:00.000Z'),
    item('c', '2026-07-29T12:00:00.000Z'), item('d', '2026-07-28T12:00:00.000Z'),
    item('e', '2026-06-30T12:00:00.000Z'),
  ]);
  assert.deepEqual(rows.map((row) => row.kind), ['header', 'row', 'row', 'header', 'row']);
  assert.equal(rows[0].count, 4);
  assert.deepEqual(rows[1].media.map((medium) => medium.id), ['a', 'b', 'c']);
});

test('media library distinguishes images and videos', () => {
  const image = item('photo.jpg', '2026-07-31T12:00:00.000Z');
  const video = item('clip.mp4', '2026-07-31T12:00:00.000Z', 'video');
  assert.equal(isVideoMedia(video), true);
  assert.deepEqual(filterLibraryMedia([image, video], 'image').map((medium) => medium.id), ['photo.jpg']);
  assert.deepEqual(filterLibraryMedia([image, video], 'video').map((medium) => medium.id), ['clip.mp4']);
});
